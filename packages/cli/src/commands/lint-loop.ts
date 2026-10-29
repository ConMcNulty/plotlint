import { mkdir, readdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Command } from "commander";
import { PipelineRunner, StateManager, chatCompletion, createLLMClient } from "@actalk/inkos-core";
import { DiagnosticLayerSchema, formatDiagnostic, type Diagnostic, type DiagnosticLayer } from "@plotlint/diagnostics";
import { loadBookRuleData, plotlintDir } from "@plotlint/rules/node";
import {
  blindOrder, DEFAULT_HELD_OUT, layerEditors, llmAuthor, PairIdSchema, PairKeySchema, PreferenceSchema, readerEditor, runLoop, runSinglePass,
  summarizePreferences, vocabularyOf, voiceLimit, type Complete, type EditScope, type Editor, type GateMode, type LoopOptions, type LoopResult,
  type PairKey, type Preference, type ReaderPersona, type RoundLog,
} from "@plotlint/loop";
import { buildPipelineConfig, findProjectRoot, loadConfig, log, logError, resolveBookId } from "../utils.js";
import { bookPacks } from "./lint-packs.js";
import { agentAuthor } from "@plotlint/provenance";
import { baselineAuthor, recordChapterRevision } from "@plotlint/provenance/node";
import type { LintOptions } from "./lint.js";

// `inkos lint loop`: the closed loop of phase 5 over one chapter. The checks of
// `inkos lint` are the continuity, developmental and line editors; the configured
// LLM is the author agent and the beta-reader panel. A run never overwrites the
// chapter unless asked (`--apply`) and the human gate lets it through; every run
// is saved under `story/plotlint/loop/runs/` with its full log for audit.
// `compare` makes a blind pair (loop against a single pass) for the gate's readers,
// `prefer` records a reader's choice and `study` reports the gate.

/** What the loop commands borrow from lint.ts. */
export interface LoopCommandDeps {
  readonly chapterFiles: (bookDir: string) => Promise<Map<number, string>>;
  readonly lintBook: (state: StateManager, id: string, options: LintOptions) => Promise<{ diagnostics: Diagnostic[] }>;
  readonly withBackoff: <T>(call: () => Promise<T>) => Promise<T>;
  readonly parseChapter: (value: string | undefined) => number | undefined;
}

const LOOP_DIR = "loop";
const PREFERENCES = "preferences.jsonl";
const SCOPES: ReadonlyArray<EditScope> = ["span", "sentence", "paragraph", "scene", "chapter"];
const GATES: ReadonlyArray<GateMode> = ["none", "escalations", "end"];

/** Read only at the start and the end of a run, never during it: the loop cannot tune itself to this reader. */
const HELD_OUT_READER: ReaderPersona = {
  name: "acquiring-editor",
  brief: "You are an acquiring editor at a publisher, reading a chapter of a submitted manuscript. You notice flat or generic prose, padding, scenes that do not earn their place, and anything that would make you stop reading the submission.",
};

const wantsJson = (command: Command) => command.optsWithGlobals<{ json?: boolean }>().json === true;
const loopDir = (bookDir: string) => join(plotlintDir(bookDir), LOOP_DIR);

function parseCount(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`--${name} takes a whole number; got "${value}"`);
  return Number(value);
}

function parseOne<T extends string>(value: string | undefined, name: string, options: ReadonlyArray<T>, fallback: T): T {
  if (value === undefined) return fallback;
  if (!options.includes(value as T)) throw new Error(`--${name} takes one of ${options.join(", ")}; got "${value}"`);
  return value as T;
}

interface LoopFlags {
  chapter?: string;
  rounds?: string;
  scope?: string;
  readers?: string;
  readerModels?: string;
  gate?: string;
  voice?: string;
  tokenBudget?: string;
  warnings?: string;
  layers?: string;
  heldOutReader?: boolean;
}

interface Prepared {
  bookId: string;
  bookDir: string;
  chapter: number;
  path: string;
  options: Omit<LoopOptions, "author"> & { author: LoopOptions["author"] };
  model: string;
  tokens: () => number;
  predictions: Array<{ reader: string; round: number; text: string }>;
}

/** Everything a run needs: the chapter, the editors over `inkos lint`, the LLM author and readers, the pack's loop settings. */
async function prepare(bookIdArg: string | undefined, flags: LoopFlags, command: Command, deps: LoopCommandDeps, say: (line: string) => void): Promise<Prepared> {
  // `lint` has its own --chapter, which takes the flag when it is given after the subcommand.
  const chapter = deps.parseChapter(flags.chapter ?? command.optsWithGlobals<{ chapter?: string }>().chapter);
  if (chapter === undefined) throw new Error("--chapter is required: the loop revises one chapter at a time");
  const root = findProjectRoot();
  const state = new StateManager(root);
  const bookId = await resolveBookId(bookIdArg, root);
  const bookDir = state.bookDir(bookId);
  const files = await deps.chapterFiles(bookDir);
  const path = files.get(chapter);
  if (!path) throw new Error(`"${bookId}" has no chapter ${chapter}`);
  const text = await readFile(path, "utf-8");
  const others = await Promise.all([...files].filter(([n]) => n !== chapter).map(([, file]) => readFile(file, "utf-8")));

  const layers = flags.layers === undefined ? new Set(DiagnosticLayerSchema.options) : new Set(flags.layers.split(",").map((name) => name.trim()) as DiagnosticLayer[]);
  for (const layer of layers) if (!DiagnosticLayerSchema.safeParse(layer).success) throw new Error(`--layers: unknown layer "${layer}"`);
  const check = async ({ text: draft }: { text: string }) => (await deps.lintBook(state, bookId, { layers, chapter, drafts: new Map([[chapter, draft]]) }))
    .diagnostics.map(({ location: _location, fingerprint: _fingerprint, ...diagnostic }: Diagnostic & { location?: unknown; fingerprint?: unknown }) => diagnostic as Diagnostic);

  const loaded = await loadBookRuleData(bookDir);
  const packs = bookPacks(bookDir, loaded);
  const loop = packs.resolved.loop;

  // The global --service/--base-url/--api-format/--model/--api-key-env flags apply, as for every LLM command.
  const config = await loadConfig({ requireApiKey: true });
  const client = createLLMClient(config.llm);
  let tokens = 0;
  const completeWith = (model: string): Complete => async (messages) => {
    const reply = await deps.withBackoff(async () => (await chatCompletion(client, model, messages, { temperature: 0.4, maxTokens: 16_384 })).content);
    // About four characters a token: enough for a budget, not for billing.
    tokens += Math.ceil((messages.reduce((sum, message) => sum + message.content.length, 0) + reply.length) / 4);
    return reply;
  };
  const model = config.llm.model;
  const predictions: Prepared["predictions"] = [];
  const editors: Editor[] = layerEditors(check);
  const readers = parseCount(flags.readers, "readers", 1);
  const readerModels = (flags.readerModels?.split(",").map((name) => name.trim()).filter(Boolean) ?? [model]).map((name) => ({ name, complete: completeWith(name) }));
  if (readers > 0) {
    editors.push(readerEditor({
      models: readerModels,
      ...(loop.readers.length ? { personas: loop.readers } : {}),
      perRound: readers,
      onPrediction: (prediction) => predictions.push(prediction),
    }));
  }
  const voiceSample = flags.voice === undefined ? undefined : await readFile(flags.voice, "utf-8");
  const limit = voiceLimit([text, ...others]);
  say(`ch${chapter}: ${packs.resolved.packs.join(" + ")} packs, voice limit ${limit.toFixed(3)}, author ${model}${readers ? `, ${readers} reader${readers === 1 ? "" : "s"} a round` : ""}`);

  return {
    bookId, bookDir, chapter, path, model, predictions,
    tokens: () => tokens,
    options: {
      chapter,
      text,
      editors,
      author: llmAuthor(completeWith(model), { name: `llm@${model}` }),
      heldOut: {
        rules: [...DEFAULT_HELD_OUT, ...loop.heldOut],
        ...(flags.heldOutReader === false ? {} : { final: [readerEditor({ models: readerModels, personas: [HELD_OUT_READER] })] }),
      },
      priority: loop.priority,
      scope: parseOne(flags.scope, "scope", SCOPES, "sentence"),
      maxRounds: parseCount(flags.rounds, "rounds", 4),
      ...(flags.warnings !== undefined ? { warningThreshold: parseCount(flags.warnings, "warnings", 0) }
        : loop.warnings === undefined ? {} : { warningThreshold: loop.warnings }),
      ...(voiceSample ? { voiceSample } : {}),
      voiceLimit: limit,
      vocabulary: vocabularyOf([text, ...others]),
      ...(flags.tokenBudget ? { tokenBudget: parseCount(flags.tokenBudget, "token-budget", 0) } : {}),
      tokensUsed: () => tokens,
      gate: parseOne(flags.gate, "gate", GATES, "escalations"),
      onRound: (round: RoundLog) => say(formatRound(round)),
    },
  };
}

function formatRound(round: RoundLog): string {
  const counts = new Map<string, number>();
  for (const decision of round.decisions) {
    const key = decision.action === "none" ? "unanswered" : `${decision.action} ${decision.outcome}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return `  round ${round.round}: ${round.open} open (score ${round.visible.weighted}, held-out ${round.heldOut.weighted}); `
    + [...counts].map(([key, n]) => `${n} ${key}`).join(", ")
    + (round.gaming.length ? `; ${round.gaming.length} gaming flag${round.gaming.length === 1 ? "" : "s"}` : "")
    + `; voice ${round.voice.toFixed(3)}`;
}

const stamp = () => new Date().toISOString().replace(/[:.]/gu, "-").replace(/Z$/u, "");

/** Save a run: the starting and final text and the full log. */
async function saveRun(bookDir: string, name: string, result: LoopResult, extra: Record<string, unknown>): Promise<string> {
  const dir = join(loopDir(bookDir), "runs", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "original.md"), result.original, "utf-8");
  await writeFile(join(dir, "draft.md"), result.text, "utf-8");
  const { original: _original, text: _text, ...rest } = result;
  await writeFile(join(dir, "log.json"), `${JSON.stringify({ ...extra, ...rest }, null, 2)}\n`, "utf-8");
  return dir;
}

const summary = (result: LoopResult) => ({
  stop: result.stop,
  rounds: result.rounds.length,
  visible: result.visible,
  heldOut: result.heldOut,
  voice: result.voice,
  gate: result.gate,
  defended: result.defended.length,
  deferred: result.deferred.length,
  escalated: result.escalated.length,
  open: result.open.length,
  pendingSettle: result.pendingSettle.length,
});

function report(result: LoopResult, dir: string): string[] {
  const lines = [
    `stopped: ${result.stop.reason} in round ${result.stop.round}${result.stop.detail ? ` (${result.stop.detail})` : ""}`,
    `visible score ${result.visible.start.weighted} → ${result.visible.end.weighted} (errors ${result.visible.start.errors} → ${result.visible.end.errors}, warnings ${result.visible.start.warnings} → ${result.visible.end.warnings})`,
    `held-out score ${result.heldOut.start.weighted} → ${result.heldOut.end.weighted}`
      + (result.heldOut.final ? `; held-out reader ${result.heldOut.final.start.weighted} → ${result.heldOut.final.end.weighted}` : ""),
    `voice distance ${result.voice.distance.toFixed(3)} (limit ${Number.isFinite(result.voice.limit) ? result.voice.limit.toFixed(3) : "off: chapter too short"})`,
    `${result.defended.length} defended, ${result.deferred.length} deferred, ${result.escalated.length} escalated`,
  ];
  for (const decision of result.escalated) lines.push(`  escalated: ${decision.ruleId}: ${decision.summary}\n    ${decision.action}: ${decision.reason}`);
  for (const diagnostic of result.open.filter((d) => d.severity !== "note")) lines.push(`  open: ${formatDiagnostic(diagnostic).split("\n")[0]}`);
  for (const diagnostic of result.pendingSettle) lines.push(`  waits on a resettle: ${formatDiagnostic(diagnostic).split("\n")[0]}`);
  lines.push(result.gate.needsHuman ? `human gate: needs review (${result.gate.reasons.join("; ")})` : "human gate: passed");
  lines.push(`saved: ${dir}`);
  return lines;
}

async function readKeys(bookDir: string): Promise<Map<string, PairKey>> {
  const dir = join(loopDir(bookDir), "keys");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const keys = new Map<string, PairKey>();
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const key = PairKeySchema.parse(JSON.parse(await readFile(join(dir, file), "utf-8")));
    keys.set(key.id, key);
  }
  return keys;
}

async function readPreferences(bookDir: string): Promise<Preference[]> {
  try {
    const text = await readFile(join(loopDir(bookDir), PREFERENCES), "utf-8");
    return text.split("\n").filter((line) => line.trim()).map((line) => PreferenceSchema.parse(JSON.parse(line)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function runOptions(command: Command): Command {
  return command
    .option("--chapter <n>", "The chapter to revise (required)")
    .option("--rounds <n>", "Most author rounds (default 4)")
    .option("--scope <unit>", `How far around a flagged span the author may edit: ${SCOPES.join(", ")} (default sentence)`)
    .option("--readers <n>", "Beta readers a round, rotating through the pack's panel; 0 for none (default 1)")
    .option("--reader-models <list>", "Models the readers rotate through, comma-separated (default the configured model)")
    .option("--no-held-out-reader", "Skip the held-out reader that compares the start and the final draft")
    .option("--voice <file>", "The author's voice sample (default the chapter as it is)")
    .option("--token-budget <n>", "Stop once the run has used about this many tokens")
    .option("--warnings <n>", "Open warnings allowed when the loop stops clean (default the pack's loop.warnings)")
    .option("--layers <list>", "Only these layers' checks (default all)")
    .option("--json", "Output JSON");
}

export function addLoopCommand(lint: Command, deps: LoopCommandDeps): void {
  const loop = runOptions(lint
    .command("loop")
    .description("Revise one chapter in the closed loop: editors file findings, the LLM author fixes, defends or defers, checks rerun until a stop condition")
    .argument("[book-id]", "Book ID (auto-detected if only one book)"))
    .option("--gate <mode>", `When a human must look before --apply writes the chapter: ${GATES.join(", ")} (default escalations)`)
    .option("--single", "One round only: the single-pass baseline")
    .option("--apply", "Write the result to the chapter file when the human gate lets it through")
    .option("--resettle", "With --apply, settle the chapter's story state again from the new text (latest chapter only), then recheck it")
    .action(async (bookIdArg: string | undefined, opts: LoopFlags & { single?: boolean; apply?: boolean; resettle?: boolean }, command: Command) => {
      try {
        const json = wantsJson(command);
        const say = (line: string) => (json ? process.stderr.write(`${line}\n`) : log(line));
        const run = await prepare(bookIdArg, opts, command, deps, say);
        const result = await (opts.single ? runSinglePass : runLoop)(run.options);
        const dir = await saveRun(run.bookDir, `${stamp()}-ch${run.chapter}-${opts.single ? "single" : "loop"}`, result,
          { bookId: run.bookId, mode: opts.single ? "single" : "loop", author: `llm@${run.model}`, tokens: run.tokens(), predictions: run.predictions });
        // Findings that only wait on a resettle do not hold the text back when --resettle will settle it.
        const latest = Math.max(...(await deps.chapterFiles(run.bookDir)).keys()) === run.chapter;
        const onlySettle = result.gate.mode === "escalations" && result.pendingSettle.length > 0 && result.gate.reasons.length === 1;
        const canResettle = opts.resettle === true && latest;
        if (opts.resettle && !latest) say(`--resettle: InkOS settles only the latest chapter again; ch${run.chapter} is not, so its state stays as it was`);
        let applied = false;
        if (opts.apply && (!result.gate.needsHuman || (onlySettle && canResettle)) && result.text !== result.original) {
          await writeFile(run.path, result.text, "utf-8");
          applied = true;
          // The loop's words are the author agent's; the rest keeps whoever wrote it.
          const indexed = (await new StateManager(findProjectRoot()).loadChapterIndex(run.bookId).catch(() => [])).find((entry) => entry.number === run.chapter);
          await recordChapterRevision(run.bookDir, run.chapter, result.original, result.text,
            { by: agentAuthor("loop-author", run.model), at: new Date().toISOString(), via: `loop:${basename(dir)}` }, baselineAuthor(indexed?.provenance));
        }
        let resettled: { open: string[] } | undefined;
        let settleFailed: string | undefined;
        if (applied && canResettle) {
          say(`settling ch${run.chapter} again from the revised text…`);
          const pipeline = new PipelineRunner(buildPipelineConfig(await loadConfig(), findProjectRoot(), {}));
          try {
            await pipeline.resyncChapterStateAndAudit(run.bookId, run.chapter);
            // Recheck: which of the findings that waited on the resettle still hold on the new state?
            const after = await deps.lintBook(new StateManager(findProjectRoot()), run.bookId, { layers: new Set(["continuity", "structure"]), chapter: run.chapter });
            const still = new Set(after.diagnostics.map((diagnostic) => `${diagnostic.ruleId}\u0000${diagnostic.summary}`));
            resettled = { open: result.pendingSettle.filter((diagnostic) => still.has(`${diagnostic.ruleId}\u0000${diagnostic.summary}`)).map((diagnostic) => `${diagnostic.ruleId}: ${diagnostic.summary}`) };
          } catch (error) {
            // The revision is on disk either way; only the state is behind it.
            settleFailed = String(error);
            say(`settling ch${run.chapter} again failed, so its story state still reflects the old text: ${settleFailed}`);
          }
        }
        if (json) {
          log(JSON.stringify({ bookId: run.bookId, chapter: run.chapter, dir, applied, ...(resettled ? { resettled } : {}), ...(settleFailed ? { settleFailed } : {}), tokens: run.tokens(), ...summary(result) }, null, 2));
        } else {
          for (const line of report(result, dir)) log(line);
          if (resettled) {
            log(`applied to ${run.path} and settled again; ${resettled.open.length} of ${result.pendingSettle.length} state finding${result.pendingSettle.length === 1 ? "" : "s"} that waited on it still hold`);
            for (const line of resettled.open) log(`  open: ${line}`);
          } else if (applied) log(`applied to ${run.path}; story state still reflects the old text until the chapter is settled again`);
          else if (opts.apply) log(result.text === result.original ? "nothing to apply: the text is unchanged" : "not applied: the human gate holds it (see the log)");
        }
        if ((result.gate.needsHuman && !(onlySettle && resettled)) || (resettled?.open.length ?? 0) > 0 || settleFailed) process.exitCode = 1;
      } catch (e) {
        logError(`Loop failed: ${e}`);
        process.exit(1);
      }
    });

  runOptions(loop
    .command("compare")
    .description("Run the loop and a single pass on the same chapter and save them as a blind pair (A and B) for readers")
    .argument("[book-id]", "Book ID (auto-detected if only one book)"))
    .option("--pair <id>", "Name of the pair (default <book>-ch<n>-<time>)")
    .action(async (bookIdArg: string | undefined, opts: LoopFlags & { pair?: string }, command: Command) => {
      try {
        const json = wantsJson(command);
        const say = (line: string) => (json ? process.stderr.write(`${line}\n`) : log(line));
        const run = await prepare(bookIdArg, { ...opts, gate: "none" }, command, deps, say);
        const id = opts.pair ?? `${run.bookId}-ch${run.chapter}-${stamp().toLowerCase()}`.replace(/[^a-z0-9-]+/gu, "-");
        if (!PairIdSchema.safeParse(id).success) throw new Error(`--pair must be lowercase letters, digits and dashes; got "${id}"`);
        say("single pass:");
        const single = await runSinglePass(run.options);
        say("loop:");
        const looped = await runLoop(run.options);
        const loopLetter = blindOrder();
        const blind = join(loopDir(run.bookDir), "blind", id);
        await mkdir(blind, { recursive: true });
        await writeFile(join(blind, `${loopLetter}.md`), looped.text, "utf-8");
        await writeFile(join(blind, `${loopLetter === "A" ? "B" : "A"}.md`), single.text, "utf-8");
        // The key sits apart from the blind folder, so the folder can be handed to a reader as it is.
        const keys = join(loopDir(run.bookDir), "keys");
        await mkdir(keys, { recursive: true });
        const key: PairKey = { version: 1, id, chapter: run.chapter, loop: loopLetter, createdAt: new Date().toISOString(), loopRun: summary(looped), singleRun: summary(single) };
        await writeFile(join(keys, `${id}.json`), `${JSON.stringify(key, null, 2)}\n`, "utf-8");
        await saveRun(run.bookDir, `${stamp()}-ch${run.chapter}-single`, single, { bookId: run.bookId, mode: "single", pair: id, author: `llm@${run.model}` });
        await saveRun(run.bookDir, `${stamp()}-ch${run.chapter}-loop`, looped, { bookId: run.bookId, mode: "loop", pair: id, author: `llm@${run.model}`, tokens: run.tokens(), predictions: run.predictions });
        if (json) {
          log(JSON.stringify({ bookId: run.bookId, pair: id, blind, tokens: run.tokens(), single: summary(single), loop: summary(looped) }, null, 2));
        } else {
          log(`single pass: visible ${single.visible.start.weighted} → ${single.visible.end.weighted}, held-out ${single.heldOut.start.weighted} → ${single.heldOut.end.weighted}`);
          log(`loop:        visible ${looped.visible.start.weighted} → ${looped.visible.end.weighted}, held-out ${looped.heldOut.start.weighted} → ${looped.heldOut.end.weighted} (${looped.stop.reason})`);
          log(`blind pair ${id}: ${blind} (A.md, B.md). Readers record a choice with \`inkos lint loop prefer ${id} A|B|same\`.`);
        }
      } catch (e) {
        logError(`Compare failed: ${e}`);
        process.exit(1);
      }
    });

  loop
    .command("prefer")
    .description("Record which version of a blind pair a reader preferred")
    .argument("<pair-id>", "The pair, from `inkos lint loop compare`")
    .argument("<choice>", "A, B or same")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--reader <name>", "Who read it")
    .option("--reason <text>", "Why, in the reader's words")
    .option("--proxy", "The reader is an LLM standing in for a person; never counted for the gate")
    .action(async (pair: string, choice: string, bookIdArg: string | undefined, opts: { reader?: string; reason?: string; proxy?: boolean }) => {
      try {
        const root = findProjectRoot();
        const bookId = await resolveBookId(bookIdArg, root);
        const bookDir = new StateManager(root).bookDir(bookId);
        if (!(await readKeys(bookDir)).has(pair)) throw new Error(`no blind pair "${pair}" in "${bookId}"`);
        const preference = PreferenceSchema.parse({
          pair, choice: choice === "same" ? "same" : choice.toUpperCase(), at: new Date().toISOString(),
          ...(opts.reader ? { reader: opts.reader } : {}), ...(opts.reason ? { reason: opts.reason } : {}), ...(opts.proxy ? { proxy: true } : {}),
        });
        await mkdir(loopDir(bookDir), { recursive: true });
        await appendFile(join(loopDir(bookDir), PREFERENCES), `${JSON.stringify(preference)}\n`, "utf-8");
        log(`recorded ${preference.choice} for ${pair}`);
      } catch (e) {
        logError(`Prefer failed: ${e}`);
        process.exit(1);
      }
    });

  loop
    .command("study")
    .description("Report the phase 5 gate: how often blind readers preferred the loop, and whether held-out scores fell")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--json", "Output JSON")
    .action(async (bookIdArg: string | undefined, _opts: unknown, command: Command) => {
      try {
        const root = findProjectRoot();
        const bookId = await resolveBookId(bookIdArg, root);
        const bookDir = new StateManager(root).bookDir(bookId);
        const keys = await readKeys(bookDir);
        const preferences = summarizePreferences(await readPreferences(bookDir), keys);
        // Held-out trend over every saved loop run: did the hidden checks get worse while the visible ones improved?
        const runs: Array<{ name: string; visible: [number, number]; heldOut: [number, number]; stop: string }> = [];
        const runsDir = join(loopDir(bookDir), "runs");
        let names: string[] = [];
        try {
          names = (await readdir(runsDir)).sort();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        for (const name of names) {
          try {
            const run = JSON.parse(await readFile(join(runsDir, name, "log.json"), "utf-8")) as { mode?: string } & Pick<LoopResult, "visible" | "heldOut" | "stop">;
            if (run.mode !== "loop") continue;
            runs.push({ name, visible: [run.visible.start.weighted, run.visible.end.weighted], heldOut: [run.heldOut.start.weighted, run.heldOut.end.weighted], stop: run.stop.reason });
          } catch {
            // A run interrupted before its log was written.
          }
        }
        const gamed = runs.filter((run) => run.visible[1] < run.visible[0] && run.heldOut[1] > run.heldOut[0]);
        if (wantsJson(command)) {
          log(JSON.stringify({ bookId, pairs: keys.size, preferences, runs, heldOutFellWhileVisibleRose: gamed.length }, null, 2));
          return;
        }
        log(`${bookId}: ${keys.size} blind pair${keys.size === 1 ? "" : "s"}`);
        log(`  readers: ${preferences.n} choices (${preferences.ties} ties), loop preferred ${preferences.loopWins}`
          + (preferences.interval ? ` (${Math.round(preferences.rate! * 100)}%, 95% CI ${Math.round(preferences.interval.low * 100)}–${Math.round(preferences.interval.high * 100)}%)` : "")
          + ` → ${preferences.call}`);
        if (preferences.proxy.n || preferences.proxy.ties) log(`  LLM proxies (not counted): ${preferences.proxy.loopWins} of ${preferences.proxy.n} preferred the loop, ${preferences.proxy.ties} ties`);
        log(`  loop runs: ${runs.length}; held-out score rose while the visible one fell in ${gamed.length}`);
        for (const run of gamed) log(`    ${run.name}: visible ${run.visible[0]} → ${run.visible[1]}, held-out ${run.heldOut[0]} → ${run.heldOut[1]} (${run.stop})`);
      } catch (e) {
        logError(`Study failed: ${e}`);
        process.exit(1);
      }
    });
}
