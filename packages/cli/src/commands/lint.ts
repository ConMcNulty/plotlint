import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { StateManager, chatCompletion, createLLMClient, loadRuntimeStateSnapshot, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import {
  builtinRegistry, checkSnapshot, RuleRegistry, checkText, compileInvariant, configureTextRules, evidenceCoverage, explainCheck, InvariantCheckSchema, InvariantIdSchema,
  InvariantsFileSchema, invariantSlug, lastChapter, type ChapterTexts, type EvidenceCoverage, type Invariant, type InvariantsFile, type TextRule,
} from "@plotlint/rules";
import {
  annotateChapter, mergeSceneAnnotations, SceneAnnotationsFileSchema, staleSceneAnnotations, type ChapterAnnotation, type SceneAnnotationsFile,
} from "@plotlint/rules";
import { loadAdaptiveOverlay, loadBookRuleData, plotlintDir, readPlotlintFile, writePlotlintFile } from "@plotlint/rules/node";
import { createHarperRule, isMostlyCjk, projectDictionary } from "@plotlint/mechanics";
import { createMetricRules, metricStateRules } from "@plotlint/metrics";
import type { MetricBands } from "@plotlint/packs";
import {
  applySuppressions,
  diagnosticFingerprint,
  DiagnosticLayerSchema,
  formatDiagnostic,
  type Diagnostic,
  type DiagnosticLayer,
  type Suppression,
} from "@plotlint/diagnostics";
import { findProjectRoot, loadConfig, log, logError, resolveBookId } from "../utils.js";
import { addSuppression, loadSuppressions, removeSuppressions, suppressionsPath } from "@plotlint/diagnostics/node";
import { registerStudyCommands } from "./lint-study.js";
import { addPacksCommand, bookPacks, effectiveRules } from "./lint-packs.js";
import { addHooksCommand } from "./lint-hooks.js";
import { addLoopCommand } from "./lint-loop.js";
import { addProvenanceCommand } from "./lint-provenance.js";

/** 1-based line and column (UTF-16 units, as most editors count) of a text finding's start in its chapter file. */
interface Location { line: number; column: number }

type LocatedDiagnostic = Diagnostic & { location?: Location };
type FingerprintedDiagnostic = LocatedDiagnostic & { fingerprint: string };

interface BookLint {
  id: string;
  diagnostics: FingerprintedDiagnostic[];
  suppressed: Array<{ diagnostic: FingerprintedDiagnostic; suppression: Suppression }>;
  stateMissing?: true;
  /** Chapters whose text was checked. */
  chapters: number[];
  /** Invariants waiting for `inkos lint invariant approve`. */
  proposedInvariants: number;
  /** The check packs that ran: general, then the book's genre packs. */
  packs: string[];
}

export interface LintOptions {
  layers: ReadonlySet<DiagnosticLayer>;
  chapter?: number;
  /** Chapter text to check in place of the file's, by chapter number (the closed loop's drafts). */
  drafts?: ReadonlyMap<number, string>;
}

const everything: LintOptions = { layers: new Set(DiagnosticLayerSchema.options) };

/** Parse `--layers mechanics,style`; an unknown name is an error rather than a silent no-op. */
function parseLayers(value: string | undefined): Set<DiagnosticLayer> {
  if (value === undefined) return new Set(DiagnosticLayerSchema.options);
  const names = value.split(",").map((name) => name.trim()).filter(Boolean);
  if (names.length === 0 || names.some((name) => !DiagnosticLayerSchema.safeParse(name).success)) {
    throw new Error(`--layers takes a comma-separated list of ${DiagnosticLayerSchema.options.join(", ")}; got "${value}"`);
  }
  return new Set(names as DiagnosticLayer[]);
}

function parseChapter(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) throw new Error(`--chapter takes a chapter number; got "${value}"`);
  return Number(value);
}

// Chapter text lives at `<bookDir>/chapters/0001_<title>.md`, as InkOS's writer saves it.
async function chapterFiles(bookDir: string): Promise<Map<number, string>> {
  const chaptersDir = join(bookDir, "chapters");
  let files: string[];
  try {
    files = await readdir(chaptersDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const byNumber = new Map<number, string>();
  for (const file of files.sort()) {
    const match = file.match(/^(\d+)_.*\.md$/u);
    if (match && !byNumber.has(Number(match[1]))) byNumber.set(Number(match[1]), join(chaptersDir, file));
  }
  return new Map([...byNumber].sort(([a], [b]) => a - b));
}

async function chapterTexts(bookDir: string): Promise<ChapterTexts> {
  const files = await chapterFiles(bookDir);
  return new Map(await Promise.all([...files].map(async ([chapter, path]) => [chapter, await readFile(path, "utf-8")] as const)));
}

/** Parse `--min 0.9`; the phase 2 gate is 0.95. */
function parseRatio(value: string | undefined): number {
  if (value === undefined) return 0.95;
  const ratio = Number(value);
  if (!/^(?:\d+\.?\d*|\.\d+)$/u.test(value.trim()) || ratio > 1) throw new Error(`--min takes a ratio from 0 to 1; got "${value}"`);
  return ratio;
}

/** L0 (Harper), L1 (the style rules of the book's packs, general first) and L2 (metrics against the packs' bands), as far as `layers` asks for them. */
function textRules(layers: ReadonlySet<DiagnosticLayer>, styleRules: ReadonlyArray<TextRule>, metricBands: MetricBands): TextRule[] {
  const rules: TextRule[] = [];
  if (layers.has("mechanics")) rules.push(createHarperRule());
  if (layers.has("style")) rules.push(...styleRules);
  if (layers.has("metrics")) rules.push(...createMetricRules(metricBands));
  return rules;
}

function locate(text: string, offset: number): Location {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return { line: text.slice(0, offset).split("\n").length, column: offset - lineStart + 1 };
}

/** Text rules over one chapter file. Both layers are English-only, so a CJK chapter gets no findings. */
async function lintChapterText(
  path: string,
  chapter: number,
  rules: ReadonlyArray<TextRule>,
  snapshot: RuntimeStateSnapshot | undefined,
  draft?: string,
): Promise<LocatedDiagnostic[]> {
  const text = draft ?? await readFile(path, "utf-8");
  if (rules.length === 0 || isMostlyCjk(text)) return [];
  const diagnostics = await checkText({ sourceId: `chapter:${chapter}`, chapter, text }, rules,
    snapshot ? { snapshot, dictionary: projectDictionary(snapshot) } : {});
  return diagnostics.map((diagnostic) => ({ ...diagnostic, location: locate(text, diagnostic.range!.start) }));
}

// The fingerprint covers the finding itself, not where the CLI found it in the file.
const withFingerprint = ({ location, ...diagnostic }: LocatedDiagnostic): FingerprintedDiagnostic =>
  ({ ...diagnostic, ...(location ? { location } : {}), fingerprint: diagnosticFingerprint(diagnostic) });

async function loadSnapshot(bookDir: string): Promise<RuntimeStateSnapshot | undefined> {
  try {
    return await loadRuntimeStateSnapshot(bookDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

const emptySnapshot = (): RuntimeStateSnapshot => ({
  manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 0, projectionVersion: 1 },
  currentState: { chapter: 0, facts: [] },
  hooks: { hooks: [] },
  chapterSummaries: { rows: [] },
});

/** Run the checks over one book's state and chapter text and split the findings by its saved suppressions. */
export async function lintBook(state: StateManager, id: string, options: LintOptions): Promise<BookLint> {
  const bookDir = state.bookDir(id);
  const { suppressions } = await loadSuppressions(bookDir);
  const snapshot = await loadSnapshot(bookDir);
  const inScope = (diagnostic: Diagnostic) =>
    options.layers.has(diagnostic.layer) && (options.chapter === undefined || diagnostic.chapter === options.chapter);

  const loaded = await loadBookRuleData(bookDir);
  const metricIds = new Set(metricStateRules().map((rule) => rule.id));
  for (const id of builtinRegistry.unknownIds(loaded.config).filter((id) => !metricIds.has(id))) logError(`${id} in story/plotlint/rules.json is not a known rule`);
  // The book's packs set the rule config, then the checks its author keeps rejecting are lowered, then its own rules.json wins.
  const packs = bookPacks(bookDir, loaded, [await loadAdaptiveOverlay(bookDir)]);
  const book = { ...loaded, config: packs.config };
  const texts = new Map([...await chapterTexts(bookDir), ...(options.drafts ?? [])]);
  // State rules run by their own layer: continuity rules under `continuity`, structural ones under `structure`.
  // Structure rules over scene annotations need no story state, so they run on an empty one.
  const stateRules = builtinRegistry.list().filter((rule) => options.layers.has(rule.layer));
  const ruleState = snapshot ?? (book.scenes ? emptySnapshot() : undefined);
  const diagnostics: LocatedDiagnostic[] = ruleState && stateRules.length > 0
    ? checkSnapshot(ruleState, { rules: stateRules, chapters: texts, book }).filter(inScope).map((diagnostic) => {
      // Invariants over the chapter text point into the chapter file like text findings.
      const text = diagnostic.range && diagnostic.chapter !== undefined ? texts.get(diagnostic.chapter) : undefined;
      return text === undefined ? diagnostic : { ...diagnostic, location: locate(text, diagnostic.range!.start) };
    })
    : [];
  const files = await chapterFiles(bookDir);
  const chapters = options.chapter === undefined ? [...files.keys()] : files.has(options.chapter) ? [options.chapter] : [];
  const rules = configureTextRules(textRules(options.layers, packs.styleRules, packs.metrics), packs.config);
  for (const chapter of chapters) diagnostics.push(...await lintChapterText(files.get(chapter)!, chapter, rules, snapshot, options.drafts?.get(chapter)));
  if (options.layers.has("metrics")) {
    // Book-level metrics (repetition across chapters) read every chapter but report into each one.
    const names = snapshot ? projectDictionary(snapshot) : [];
    for (const { rule, enabled, severity, options: ruleOptions } of new RuleRegistry(metricStateRules({ names, bands: packs.metrics })).configure(book.config)) {
      if (!enabled) continue;
      // The rule reads only chapter text and names, so a book without state still gets it.
      for (const diagnostic of rule.check({ snapshot: snapshot ?? ({} as RuntimeStateSnapshot), chapters: texts, book, options: ruleOptions })) {
        if (!inScope(diagnostic)) continue;
        const text = texts.get(diagnostic.chapter!)!;
        diagnostics.push({ ...diagnostic, ...(severity ? { severity } : {}), location: locate(text, diagnostic.range!.start) });
      }
    }
  }

  const { kept, suppressed } = applySuppressions(diagnostics, suppressions);
  return {
    id,
    diagnostics: kept.map(withFingerprint),
    suppressed: suppressed.map((entry) => ({ diagnostic: withFingerprint(entry.diagnostic), suppression: entry.suppression })),
    ...(snapshot ? {} : { stateMissing: true as const }),
    chapters,
    // Unsupported ones cannot be approved, so they are not waiting on the author.
    proposedInvariants: book.invariants?.invariants
      .filter((invariant) => invariant.status === "proposed" && invariant.check.kind !== "unsupported").length ?? 0,
    packs: packs.resolved.packs,
  };
}

const indent = (text: string) => text.replace(/^/gmu, "  ");

function formatFinding(diagnostic: FingerprintedDiagnostic, verbose: boolean): string {
  let text = formatDiagnostic(diagnostic);
  // A ranged finding points into its chapter file like a compiler error: `ch3:12:5 warning ...`.
  if (diagnostic.location && diagnostic.chapter !== undefined) {
    const where = `ch${diagnostic.chapter}`;
    text = `${where}:${diagnostic.location.line}:${diagnostic.location.column}${text.slice(where.length)}`;
  }
  if (!verbose) return text;
  const [head, ...rest] = text.split("\n");
  return [`${head} (${diagnostic.fingerprint})`, ...rest].join("\n");
}

const describeSuppression = (suppression: Suppression) =>
  `${suppression.kind === "rule" ? "rule suppressed" : "suppressed"}: ${suppression.reason}`;

// `inkos lint` itself takes --json, so commander may hand a subcommand's --json to the parent.
const wantsJson = (command: Command) => command.optsWithGlobals<{ json?: boolean }>().json === true;

export const lintCommand = new Command("lint")
  .description("Run plotlint's deterministic checks over a book's runtime state and chapter text")
  .argument("[book-id]", "Book ID (optional, checks all if omitted)")
  .option("--json", "Output JSON")
  .option("--layers <list>", `Only these layers, comma-separated (${DiagnosticLayerSchema.options.join(", ")}); default all`)
  .option("--chapter <n>", "Only findings in this chapter")
  .option("--show-suppressed", "Also list findings hidden by suppressions")
  .option("--verbose", "Show each finding's fingerprint, for `inkos lint suppress --fingerprint`")
  .action(async (bookIdArg: string | undefined, opts: {
    json?: boolean; layers?: string; chapter?: string; showSuppressed?: boolean; verbose?: boolean;
  }) => {
    try {
      const options: LintOptions = { layers: parseLayers(opts.layers), chapter: parseChapter(opts.chapter) };
      const root = findProjectRoot();
      const state = new StateManager(root);
      const allBookIds = await state.listBooks();
      if (bookIdArg && !allBookIds.includes(bookIdArg)) {
        throw new Error(`Book "${bookIdArg}" not found. Available: ${allBookIds.join(", ") || "(none)"}`);
      }

      const results: BookLint[] = [];
      for (const id of bookIdArg ? [bookIdArg] : allBookIds) results.push(await lintBook(state, id, options));

      if (opts.json) {
        log(JSON.stringify({ books: results }, null, 2));
      } else {
        const verbose = opts.verbose === true;
        for (const result of results) {
          log(`${result.id}:`);
          if (result.stateMissing) log("  no runtime state yet");
          if (result.diagnostics.length === 0 && (!result.stateMissing || result.chapters.length > 0)) log("  no problems");
          for (const diagnostic of result.diagnostics) log(indent(formatFinding(diagnostic, verbose)));
          if (result.proposedInvariants > 0) {
            log(`  ${result.proposedInvariants} proposed invariant${result.proposedInvariants === 1 ? "" : "s"} not yet approved (inkos lint invariant list)`);
          }
          if (result.suppressed.length === 0) continue;
          if (opts.showSuppressed) {
            for (const { diagnostic, suppression } of result.suppressed) {
              log(indent(`[${describeSuppression(suppression)}] ${formatFinding(diagnostic, verbose)}`));
            }
          } else {
            log(`  ${result.suppressed.length} suppressed (--show-suppressed to list)`);
          }
        }
      }

      if (results.some((result) => result.diagnostics.some((diagnostic) => diagnostic.severity === "error"))) {
        process.exitCode = 1;
      }
    } catch (e) {
      logError(`Lint failed: ${e}`);
      process.exit(1);
    }
  });

lintCommand
  .command("suppress")
  .description("Mark a finding as intentional (--fingerprint) or turn a check off for a whole book")
  .argument("<rule-id>", "Rule ID, e.g. continuity/dead-entity-acts")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .requiredOption("--reason <text>", "Why this is intentional; saved with the suppression")
  .option("--fingerprint <fp>", "Suppress one finding only (from `inkos lint --verbose` or `--json`)")
  .option("--author <name>", "Who suppressed it")
  .option("--json", "Output JSON")
  .action(async (ruleId: string, bookIdArg: string | undefined, opts: {
    reason: string; fingerprint?: string; author?: string; json?: boolean;
  }, command: Command) => {
    try {
      opts = { ...opts, json: wantsJson(command) };
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const reason = opts.reason.trim();
      if (!reason) throw new Error("--reason must not be empty");
      const createdAt = new Date().toISOString();
      const author = opts.author?.trim() ? { author: opts.author.trim() } : {};

      let suppression: Suppression;
      if (opts.fingerprint) {
        // Record where the finding is and what it said, so the file reads well to a human.
        const result = await lintBook(state, bookId, everything);
        const finding = [...result.diagnostics, ...result.suppressed.map((entry) => entry.diagnostic)]
          .find((diagnostic) => diagnostic.ruleId === ruleId && diagnostic.fingerprint === opts.fingerprint);
        if (!finding) {
          throw new Error(`No ${ruleId} finding with fingerprint ${opts.fingerprint} in "${bookId}". Run \`inkos lint ${bookId} --verbose\` to list fingerprints.`);
        }
        suppression = {
          kind: "instance",
          ruleId,
          fingerprint: finding.fingerprint,
          reason,
          createdAt,
          ...author,
          ...(finding.chapter === undefined ? {} : { chapter: finding.chapter }),
          quote: finding.sourceRefs?.[0]?.quote ?? finding.summary,
        };
      } else {
        suppression = { kind: "rule", ruleId, reason, createdAt, ...author };
      }

      const bookDir = state.bookDir(bookId);
      const { replaced } = await addSuppression(bookDir, suppression);
      if (opts.json) {
        log(JSON.stringify({ bookId, suppression, replaced, path: suppressionsPath(bookDir) }, null, 2));
      } else {
        const what = suppression.kind === "rule" ? `all ${ruleId} findings` : `${ruleId} finding ${suppression.fingerprint}`;
        log(`${replaced ? "Updated" : "Suppressed"} ${what} in "${bookId}": ${reason}`);
      }
    } catch (e) {
      logError(`Suppress failed: ${e}`);
      process.exit(1);
    }
  });

const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

/** The gate line, a per-chapter table and the fact ops that fail, for `inkos lint evidence`. */
function formatCoverage(bookId: string, coverage: EvidenceCoverage, min: number): string[] {
  const verdict = coverage.ratio >= min ? `meets the ${percent(min)} gate` : `below the ${percent(min)} gate`;
  const lines = [`${bookId}: ${coverage.valid}/${coverage.total} fact ops have a valid evidence span (${percent(coverage.ratio)}), ${verdict}`];
  if (coverage.total === 0) return lines;
  const rows = [["chapter", "valid", "total", "ratio"], ...coverage.byChapter.map((row) =>
    [`ch${row.chapter}`, String(row.valid), String(row.total), percent(row.valid / row.total)])];
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  for (const row of rows) lines.push(`  ${row.map((cell, column) => column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)).join("  ")}`);
  if (coverage.issues.length > 0) lines.push("  failing fact ops:");
  for (const issue of coverage.issues) {
    const { fact } = issue;
    const cited = issue.op === "upsert" ? fact.evidence : fact.endEvidence;
    // A quote that is not in the chapter is shown, so the writer can see what the settler claimed.
    const quote = issue.status === "not-found" && cited ? ` "${cited.quote.length > 60 ? `${cited.quote.slice(0, 57)}...` : cited.quote}"` : "";
    lines.push(`    ${issue.status} ch${issue.chapter} ${issue.op}: ${fact.subject} · ${fact.predicate} · ${fact.object}${quote}`);
  }
  return lines;
}

lintCommand
  .command("evidence")
  .description("Check that each settled fact op cites a passage still in its chapter (the phase 2 evidence gate)")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--min <ratio>", "Fail when fewer than this share of fact ops validate (default 0.95)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts: { min?: string; json?: boolean }, command: Command) => {
    try {
      opts = { ...opts, json: wantsJson(command) };
      const min = parseRatio(opts.min);
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const bookDir = new StateManager(root).bookDir(bookId);
      const snapshot = await loadSnapshot(bookDir);
      // A book with no settled state has no fact ops to check.
      const coverage = snapshot ? evidenceCoverage(snapshot, await chapterTexts(bookDir)) : undefined;
      const passed = coverage === undefined || coverage.ratio >= min;
      if (opts.json) {
        log(JSON.stringify({ bookId, min, passed, ...(coverage ?? { stateMissing: true }) }, null, 2));
      } else if (!coverage) {
        log(`${bookId}: no runtime state yet`);
      } else {
        for (const line of formatCoverage(bookId, coverage, min)) log(line);
      }
      if (!passed) process.exitCode = 1;
    } catch (e) {
      logError(`Evidence check failed: ${e}`);
      process.exit(1);
    }
  });

lintCommand
  .command("rules")
  .description("List every rule (state, mechanics, metrics, style) with its effective setting and where it comes from: a pack, the adaptive overlay or rules.json")
  .argument("[book-id]", "Book ID (auto-detected if only one book); without a project, lists the defaults")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts: { json?: boolean }, command: Command) => {
    try {
      opts = { ...opts, json: wantsJson(command) };
      let bookDir: string | undefined;
      try {
        const root = findProjectRoot();
        const bookId = await resolveBookId(bookIdArg, root);
        bookDir = new StateManager(root).bookDir(bookId);
      } catch (error) {
        if (bookIdArg !== undefined) throw error;
      }
      const { rules, unknown } = await effectiveRules(bookDir);
      if (opts.json) {
        log(JSON.stringify({ rules, unknown }, null, 2));
        return;
      }
      for (const rule of rules) {
        const setting = !rule.enabled ? "off" : rule.severity ?? "on";
        log(`${rule.id}  ${setting}  (${rule.from.join(", ")})  ${rule.title}`);
        log(indent(rule.rationale));
      }
      for (const id of unknown) logError(`${id} in rules.json is not a known rule`);
    } catch (e) {
      logError(`Rules failed: ${e}`);
      process.exit(1);
    }
  });

lintCommand
  .command("unsuppress")
  .description("Remove a suppression: the rule-wide one, one instance (--fingerprint) or all for the rule (--all)")
  .argument("<rule-id>", "Rule ID, e.g. continuity/dead-entity-acts")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--fingerprint <fp>", "Remove the suppression of one finding")
  .option("--all", "Remove every suppression of this rule, rule-wide and per instance")
  .option("--json", "Output JSON")
  .action(async (ruleId: string, bookIdArg: string | undefined, opts: { fingerprint?: string; all?: boolean; json?: boolean }, command: Command) => {
    try {
      opts = { ...opts, json: wantsJson(command) };
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const removed = await removeSuppressions(new StateManager(root).bookDir(bookId), {
        ruleId,
        ...(opts.fingerprint ? { fingerprint: opts.fingerprint } : {}),
        all: opts.all === true,
      });
      if (opts.json) {
        log(JSON.stringify({ bookId, removed }, null, 2));
      } else if (removed.length === 0) {
        log(`No matching ${ruleId} suppression in "${bookId}".`);
      } else {
        log(`Removed ${removed.length} ${ruleId} suppression${removed.length === 1 ? "" : "s"} from "${bookId}".`);
      }
      if (removed.length === 0) process.exitCode = 1;
    } catch (e) {
      logError(`Unsuppress failed: ${e}`);
      process.exit(1);
    }
  });

// Author-written invariants, saved in `story/plotlint/invariants.json`. `add`
// compiles the author's sentence with the configured LLM into the check language
// of @plotlint/rules and saves it as proposed; only approved ones run in `inkos lint`.

const INVARIANTS = "invariants.json";

async function loadInvariants(bookDir: string): Promise<InvariantsFile> {
  return await readPlotlintFile(bookDir, INVARIANTS, InvariantsFileSchema) ?? { version: 1, invariants: [] };
}

const saveInvariants = (bookDir: string, file: InvariantsFile) => writePlotlintFile(bookDir, INVARIANTS, InvariantsFileSchema, file);

function findInvariant(file: InvariantsFile, id: string, bookId: string): Invariant {
  const invariant = file.invariants.find((entry) => entry.id === id);
  if (!invariant) {
    throw new Error(`No invariant "${id}" in "${bookId}". Known: ${file.invariants.map((entry) => entry.id).join(", ") || "(none)"}`);
  }
  return invariant;
}

/** An id not taken yet: the wanted one, else with -2, -3... */
function freeId(file: InvariantsFile, wanted: string): string {
  const taken = new Set(file.invariants.map((entry) => entry.id));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) if (!taken.has(`${wanted}-${n}`)) return `${wanted}-${n}`;
}

function formatInvariant(invariant: Invariant): string[] {
  const status = invariant.check.kind === "unsupported" ? "unsupported" : invariant.status;
  return [
    `${invariant.id}  ${status}  "${invariant.text}"`,
    indent(invariant.explanation),
    indent(`check: ${JSON.stringify(invariant.check)}`),
  ];
}

/** Subjects of the book's facts, most frequent first, so the model spells names the way the state does. */
function stateNames(snapshot: RuntimeStateSnapshot | undefined): string[] {
  const counts = new Map<string, number>();
  for (const fact of snapshot?.currentState.facts ?? []) counts.set(fact.subject, (counts.get(fact.subject) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

const issues = (error: { issues: Array<{ path: Array<string | number>; message: string }> }) =>
  error.issues.map((issue) => `${issue.path.join(".") || "check"}: ${issue.message}`).join("; ");

const invariantCommand = lintCommand
  .command("invariant")
  .description("Author-written invariants: rules about your book in plain language, checked on every lint");

invariantCommand
  .command("add")
  .description("Compile a rule written in plain language with the configured LLM and save it as proposed")
  .argument("<text>", "The rule, e.g. \"Mira must not learn the captain's identity before chapter 20\"")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--check <json>", "Use this compiled check instead of asking the LLM")
  .option("--id <id>", "The invariant's id (kebab-case); by default the LLM's suggestion or a slug of the text")
  .option("--json", "Output JSON")
  .action(async (text: string, bookIdArg: string | undefined, opts: { check?: string; id?: string; json?: boolean }, command: Command) => {
    try {
      opts = { ...opts, json: wantsJson(command) };
      const rule = text.trim();
      if (!rule) throw new Error("the invariant's text must not be empty");
      if (opts.id !== undefined && !InvariantIdSchema.safeParse(opts.id).success) throw new Error(`--id must be lowercase kebab-case; got "${opts.id}"`);
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const bookDir = new StateManager(root).bookDir(bookId);
      const file = await loadInvariants(bookDir);

      let compiled: { id: string; check: Invariant["check"]; explanation: string };
      if (opts.check !== undefined) {
        let json: unknown;
        try {
          json = JSON.parse(opts.check);
        } catch (error) {
          throw new Error(`--check is not JSON: ${(error as Error).message}`);
        }
        const check = InvariantCheckSchema.safeParse(json);
        if (!check.success) throw new Error(`--check is not a valid check: ${issues(check.error)}`);
        compiled = { id: invariantSlug(rule), check: check.data, explanation: explainCheck(check.data) };
      } else {
        // The global --service/--base-url/--api-format/--model/--api-key-env flags apply, as for every LLM command.
        // Reasoning models think at length before the JSON, so the output budget is generous.
        const config = await loadConfig({ requireApiKey: true });
        const client = createLLMClient(config.llm);
        const snapshot = await loadSnapshot(bookDir);
        const texts = await chapterTexts(bookDir);
        const last = snapshot ? lastChapter(snapshot, texts) : texts.size ? Math.max(...texts.keys()) : undefined;
        compiled = await compileInvariant(rule, async (messages) =>
          (await chatCompletion(client, config.llm.model, messages, { temperature: 0, maxTokens: 16_384 })).content,
        { names: stateNames(snapshot), ...(last === undefined ? {} : { lastChapter: last }) });
      }

      const invariant: Invariant = {
        id: opts.id ?? freeId(file, compiled.id),
        text: rule,
        status: "proposed",
        check: compiled.check,
        explanation: compiled.explanation,
        createdAt: new Date().toISOString(),
      };
      if (file.invariants.some((entry) => entry.id === invariant.id)) throw new Error(`An invariant "${invariant.id}" already exists in "${bookId}"`);
      const path = await saveInvariants(bookDir, { ...file, invariants: [...file.invariants, invariant] });
      if (opts.json) {
        log(JSON.stringify({ bookId, invariant, path }, null, 2));
        return;
      }
      for (const line of formatInvariant(invariant)) log(line);
      log(invariant.check.kind === "unsupported"
        ? "This rule cannot be checked deterministically, so it is saved but will not run."
        : `Saved as proposed. Run \`inkos lint invariant approve ${invariant.id}\` once the check says what you meant.`);
    } catch (e) {
      logError(`Invariant add failed: ${e}`);
      process.exit(1);
    }
  });

invariantCommand
  .command("approve")
  .description("Approve a proposed invariant, so `inkos lint` checks it")
  .argument("<id>", "Invariant ID (from `inkos lint invariant list`)")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .action(async (id: string, bookIdArg: string | undefined, opts: { json?: boolean }, command: Command) => {
    try {
      opts = { ...opts, json: wantsJson(command) };
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const bookDir = new StateManager(root).bookDir(bookId);
      const file = await loadInvariants(bookDir);
      const found = findInvariant(file, id, bookId);
      if (found.check.kind === "unsupported") {
        throw new Error(`"${id}" cannot be checked deterministically (${found.check.reason}); remove it, or add it again with --check`);
      }
      const invariant: Invariant = { ...found, status: "approved", approvedAt: new Date().toISOString() };
      await saveInvariants(bookDir, { ...file, invariants: file.invariants.map((entry) => (entry.id === id ? invariant : entry)) });
      if (opts.json) log(JSON.stringify({ bookId, invariant }, null, 2));
      else log(`Approved "${id}" in "${bookId}": ${invariant.explanation}`);
    } catch (e) {
      logError(`Invariant approve failed: ${e}`);
      process.exit(1);
    }
  });

invariantCommand
  .command("list")
  .description("List the book's invariants with their compiled checks")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts: { json?: boolean }, command: Command) => {
    try {
      opts = { ...opts, json: wantsJson(command) };
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const bookDir = new StateManager(root).bookDir(bookId);
      const file = await loadInvariants(bookDir);
      if (opts.json) {
        log(JSON.stringify({ bookId, path: join(plotlintDir(bookDir), INVARIANTS), invariants: file.invariants }, null, 2));
        return;
      }
      if (file.invariants.length === 0) log(`${bookId}: no invariants yet (inkos lint invariant add "<rule>")`);
      for (const invariant of file.invariants) for (const line of formatInvariant(invariant)) log(line);
    } catch (e) {
      logError(`Invariant list failed: ${e}`);
      process.exit(1);
    }
  });

invariantCommand
  .command("remove")
  .description("Remove an invariant")
  .argument("<id>", "Invariant ID")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .action(async (id: string, bookIdArg: string | undefined, opts: { json?: boolean }, command: Command) => {
    try {
      opts = { ...opts, json: wantsJson(command) };
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const bookDir = new StateManager(root).bookDir(bookId);
      const file = await loadInvariants(bookDir);
      const removed = findInvariant(file, id, bookId);
      await saveInvariants(bookDir, { ...file, invariants: file.invariants.filter((entry) => entry.id !== id) });
      if (opts.json) log(JSON.stringify({ bookId, removed }, null, 2));
      else log(`Removed "${id}" from "${bookId}".`);
    } catch (e) {
      logError(`Invariant remove failed: ${e}`);
      process.exit(1);
    }
  });

// `inkos lint study` and `inkos lint verdict` (lint-study.ts); a verdict looks its finding up among shown and suppressed ones.
registerStudyCommands(lintCommand, async (state, bookId) => {
  const result = await lintBook(state, bookId, everything);
  return [...result.diagnostics, ...result.suppressed.map((entry) => entry.diagnostic)];
});

addPacksCommand(lintCommand);

// Scene annotations for the structure rules, saved in `story/plotlint/scenes.json`.
// The configured LLM annotates each chapter's scenes; unchanged scenes and
// entries the author wrote (annotator "author") are kept.

const SCENES = "scenes.json";

/** Transient upstream failures (rate limits, overloaded servers) get a few slower retries on top of the client's own. */
async function withBackoff<T>(call: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= attempts || !/\b(?:429|500|502|503|504)\b|rate limit|overloaded|timed? ?out|ECONNRESET/iu.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5_000 * attempt));
    }
  }
}

// `inkos lint hooks` and `inkos lint hooks reconcile` (lint-hooks.ts).
addHooksCommand(lintCommand, { chapterTexts, loadSnapshot, withBackoff, parseChapter });

// `inkos lint loop`, `compare`, `prefer` and `study` (lint-loop.ts).
addLoopCommand(lintCommand, { chapterFiles, lintBook, withBackoff, parseChapter });

// `inkos lint provenance` and `provenance record` (lint-provenance.ts).
addProvenanceCommand(lintCommand, { chapterTexts, parseChapter });

lintCommand
  .command("annotate")
  .description("Annotate each scene (POV, goal, opposition, outcome, values, stakes) with the configured LLM, for the structure checks")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--chapter <n>", "Only this chapter")
  .option("--force", "Re-annotate scenes whose text has not changed (entries by the author are still kept)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts: { chapter?: string; force?: boolean; json?: boolean }, command: Command) => {
    try {
      opts = { ...opts, json: wantsJson(command) };
      // `lint` has its own --chapter, which takes the flag when it is given after the subcommand.
      const only = parseChapter(opts.chapter ?? command.optsWithGlobals<{ chapter?: string }>().chapter);
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const bookDir = new StateManager(root).bookDir(bookId);
      const texts = await chapterTexts(bookDir);
      const chapters = only === undefined ? [...texts.keys()] : texts.has(only) ? [only] : [];
      if (chapters.length === 0) throw new Error(only === undefined ? `"${bookId}" has no chapters` : `"${bookId}" has no chapter ${only}`);

      // The global --service/--base-url/--api-format/--model/--api-key-env flags apply, as for every LLM command.
      const config = await loadConfig({ requireApiKey: true });
      const client = createLLMClient(config.llm);
      const complete = (messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>) =>
        withBackoff(async () => (await chatCompletion(client, config.llm.model, messages, { temperature: 0, maxTokens: 16_384 })).content);
      const names = stateNames(await loadSnapshot(bookDir)).slice(0, 40);
      let file: SceneAnnotationsFile = await readPlotlintFile(bookDir, SCENES, SceneAnnotationsFileSchema) ?? { version: 1, scenes: [] };

      const results: ChapterAnnotation[] = [];
      const failed: Array<{ chapter: number; error: string }> = [];
      for (const chapter of chapters) {
        try {
          const result = await annotateChapter(chapter, texts.get(chapter)!, complete, {
            annotator: `llm@${config.llm.model}`,
            existing: file.scenes,
            ...(opts.force ? { force: true } : {}),
            ...(file.protagonist ? { protagonist: file.protagonist } : {}),
            ...(names.length ? { names } : {}),
            // The model call can take minutes; say what is running (on stderr when stdout carries JSON).
            onCall: (ids, attempt) => {
              const scenes = `${ids.length} scene${ids.length === 1 ? "" : "s"}`;
              const line = attempt === 1 ? `ch${chapter}: annotating ${scenes}…` : `ch${chapter}: reply unusable, asking again (attempt ${attempt})…`;
              if (opts.json) process.stderr.write(`${line}\n`);
              else log(line);
            },
          });
          results.push(result);
          // Saved after every chapter, so an interrupted run keeps what it did.
          file = { ...file, scenes: mergeSceneAnnotations(file.scenes, result.scenes, [chapter]) };
          await writePlotlintFile(bookDir, SCENES, SceneAnnotationsFileSchema, file);
          if (!opts.json) {
            const { given, located } = result.quotes;
            log(`ch${chapter}: ${result.annotated.length} annotated, ${result.kept.length} kept`
              + (result.missing.length ? `, ${result.missing.length} not annotated (${result.missing.join(", ")})` : "")
              + (given ? `, ${located}/${given} quotes located` : ""));
          }
        } catch (error) {
          failed.push({ chapter, error: String(error) });
          if (!opts.json) logError(`ch${chapter}: ${error}`);
        }
      }

      const given = results.reduce((sum, result) => sum + result.quotes.given, 0);
      const located = results.reduce((sum, result) => sum + result.quotes.located, 0);
      const annotated = file.scenes.filter((entry) => chapters.includes(entry.chapter)).length;
      const stale = staleSceneAnnotations(file, texts).map((entry) => entry.id);
      const path = join(plotlintDir(bookDir), SCENES);
      if (opts.json) {
        log(JSON.stringify({
          bookId, path, chapters: results.map(({ scenes: _scenes, ...rest }) => rest), failed,
          scenes: annotated, quotes: { given, located }, stale,
        }, null, 2));
      } else {
        log(`${bookId}: ${annotated} scene${annotated === 1 ? "" : "s"} annotated in ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}`
          + (given ? `, ${located} of ${given} new quotes located in the text` : "") + ` (${path})`);
        if (stale.length) log(`  ${stale.length} scene${stale.length === 1 ? "" : "s"} changed since annotated: ${stale.join(", ")}`);
        log("  Run `inkos lint --layers structure` for the structure checks.");
      }
      if (failed.length) process.exitCode = 1;
    } catch (e) {
      logError(`Annotate failed: ${e}`);
      process.exit(1);
    }
  });
