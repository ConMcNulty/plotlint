import { join } from "node:path";
import type { Command } from "commander";
import { StateManager, chatCompletion, createLLMClient, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import {
  hookHash, HookOverlayFileSchema, hooksToReconcile, hookStatusRows, mergeHookOverlay, reconcileHook,
  type ChapterTexts, type HookOverlayEntry, type HookOverlayFile, type HookStatusRow,
} from "@plotlint/rules";
import { plotlintDir, readPlotlintFile, writePlotlintFile } from "@plotlint/rules/node";
import { findProjectRoot, loadConfig, log, logError, resolveBookId } from "../utils.js";

// `inkos lint hooks`: the settler's hook ledger beside plotlint's overlay,
// `story/plotlint/hooks.json`; `inkos lint hooks reconcile` asks the configured
// LLM, hook by hook, whether a later chapter answers a hook the ledger leaves
// open. The structure rules read the ledger through the overlay.

const HOOKS = "hooks.json";

/** What the hooks commands borrow from lint.ts. */
export interface HooksCommandDeps {
  readonly chapterTexts: (bookDir: string) => Promise<ChapterTexts>;
  readonly loadSnapshot: (bookDir: string) => Promise<RuntimeStateSnapshot | undefined>;
  readonly withBackoff: <T>(call: () => Promise<T>) => Promise<T>;
  readonly parseChapter: (value: string | undefined) => number | undefined;
}

const wantsJson = (command: Command) => command.optsWithGlobals<{ json?: boolean }>().json === true;
const short = (text: string, max = 70) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

function formatRow(row: HookStatusRow): string {
  const overlay = row.opened === 0 && row.lastAdvanced === 0 ? "never on the page"
    : row.state === "resolved" || row.state === "superseded" ? "-"
    : !row.entry ? "not checked"
    : row.resolvedIn !== undefined ? `resolved ch${row.resolvedIn} (${row.entry.annotator})`
    : row.entry.status === "resolved" ? `resolved ch${row.entry.resolvedIn}, evidence not found (ignored)`
    : `open (${row.entry.annotator})`;
  return `  ${row.id.padEnd(24)} ch${row.opened}→ch${row.lastAdvanced}  ${row.state.padEnd(11)} ${overlay}${row.stale ? ", stale" : ""}\n    ${short(row.promise)}`
    + (row.resolvedIn !== undefined && row.entry?.evidence ? `\n    "${short(row.entry.evidence, 100)}"` : "");
}

async function load(bookIdArg: string | undefined, deps: HooksCommandDeps) {
  const root = findProjectRoot();
  const bookId = await resolveBookId(bookIdArg, root);
  const bookDir = new StateManager(root).bookDir(bookId);
  const snapshot = await deps.loadSnapshot(bookDir);
  if (!snapshot) throw new Error(`"${bookId}" has no runtime state yet`);
  const texts = await deps.chapterTexts(bookDir);
  const file: HookOverlayFile = await readPlotlintFile(bookDir, HOOKS, HookOverlayFileSchema) ?? { version: 1, hooks: [] };
  return { bookId, bookDir, snapshot, texts, file };
}

export function addHooksCommand(lint: Command, deps: HooksCommandDeps): void {
  const hooks = lint
    .command("hooks")
    .description("List the hook ledger's status beside plotlint's overlay (story/plotlint/hooks.json)")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--json", "Output JSON")
    .action(async (bookIdArg: string | undefined, _opts: { json?: boolean }, command: Command) => {
      try {
        const { bookId, snapshot, texts, file } = await load(bookIdArg, deps);
        const rows = hookStatusRows(snapshot, file, texts);
        if (wantsJson(command)) {
          log(JSON.stringify({ bookId, hooks: rows }, null, 2));
          return;
        }
        const open = rows.filter((row) => row.state !== "resolved" && row.state !== "superseded");
        const resolved = rows.filter((row) => row.resolvedIn !== undefined);
        log(`${bookId}: ${rows.length} hooks, ${open.length} left open by the ledger, ${resolved.length} of them resolved by the overlay`);
        for (const row of rows) log(formatRow(row));
        if (open.some((row) => !row.entry || row.stale)) log("  Run `inkos lint hooks reconcile` to check the open ones against later chapters.");
      } catch (e) {
        logError(`Hooks failed: ${e}`);
        process.exit(1);
      }
    });

  hooks
    .command("reconcile")
    .description("Ask the configured LLM whether a later chapter answers each hook the ledger leaves open; saves story/plotlint/hooks.json")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--chapter <n>", "Only hooks opened in this chapter")
    .option("--force", "Ask again about hooks unchanged since the last run (the author's entries are still kept)")
    .option("--json", "Output JSON")
    .action(async (bookIdArg: string | undefined, opts: { chapter?: string; force?: boolean }, command: Command) => {
      try {
        const json = wantsJson(command);
        // `lint` has its own --chapter, which takes the flag when it is given after the subcommand.
        const only = deps.parseChapter(opts.chapter ?? command.optsWithGlobals<{ chapter?: string }>().chapter);
        const loaded = await load(bookIdArg, deps);
        const { bookId, bookDir, snapshot, texts } = loaded;
        let file = loaded.file;
        const say = (line: string) => (json ? process.stderr.write(`${line}\n`) : log(line));

        // The global --service/--base-url/--api-format/--model/--api-key-env flags apply, as for every LLM command.
        const config = await loadConfig({ requireApiKey: true });
        const client = createLLMClient(config.llm);
        const complete = (messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>) =>
          deps.withBackoff(async () => (await chatCompletion(client, config.llm.model, messages, { temperature: 0, maxTokens: 8_192 })).content);
        const annotator = `llm@${config.llm.model}`;

        const candidates = hooksToReconcile(snapshot, texts, only);
        const existing = new Map(file.hooks.map((entry) => [entry.id, entry]));
        const results: Array<{ id: string; outcome: "resolved" | "open" | "dropped" | "kept" | "author" | "failed"; entry?: HookOverlayEntry; error?: string }> = [];
        for (const [index, hook] of candidates.entries()) {
          const prefix = `[${index + 1}/${candidates.length}] ${hook.hookId}`;
          const current = existing.get(hook.hookId);
          if (current?.annotator === "author") {
            results.push({ id: hook.hookId, outcome: "author", entry: current });
            say(`${prefix}: kept (the author's entry)`);
            continue;
          }
          if (!opts.force && current?.hookHash === hookHash(hook, texts)) {
            results.push({ id: hook.hookId, outcome: "kept", entry: current });
            say(`${prefix}: unchanged, kept (${current.status}${current.resolvedIn ? ` ch${current.resolvedIn}` : ""})`);
            continue;
          }
          try {
            const result = await reconcileHook(hook, texts, complete, {
              annotator,
              onCall: (_hook, attempt) => say(attempt === 1 ? `${prefix}: asking…` : `${prefix}: reply unusable, asking again (attempt ${attempt})…`),
            });
            // Saved after every hook, so an interrupted run keeps what it did.
            file = { ...file, hooks: mergeHookOverlay(file.hooks, [result.entry]) };
            await writePlotlintFile(bookDir, HOOKS, HookOverlayFileSchema, file);
            const outcome = result.entry.status === "resolved" ? "resolved" : result.dropped ? "dropped" : "open";
            results.push({ id: hook.hookId, outcome, entry: result.entry });
            say(`${prefix}: ${outcome === "resolved" ? `resolved in ch${result.entry.resolvedIn}: "${short(result.entry.evidence ?? "", 90)}"`
              : outcome === "dropped" ? `stays open (${result.entry.note})` : "stays open"}`);
          } catch (error) {
            results.push({ id: hook.hookId, outcome: "failed", error: String(error) });
            if (!json) logError(`${prefix}: ${error}`);
          }
        }

        const count = (outcome: string) => results.filter((result) => result.outcome === outcome).length;
        const path = join(plotlintDir(bookDir), HOOKS);
        if (json) {
          log(JSON.stringify({ bookId, path, hooks: results }, null, 2));
        } else {
          log(`${bookId}: ${candidates.length} open hook${candidates.length === 1 ? "" : "s"} checked: ${count("resolved")} resolved by a later chapter, `
            + `${count("open")} still open, ${count("dropped")} answers dropped (quote not found), ${count("kept") + count("author")} kept`
            + (count("failed") ? `, ${count("failed")} failed` : "") + ` (${path})`);
          log("  Run `inkos lint hooks` to list them, `inkos lint --layers structure` for the structure checks.");
        }
        if (count("failed")) process.exitCode = 1;
      } catch (e) {
        logError(`Reconcile failed: ${e}`);
        process.exit(1);
      }
    });
}
