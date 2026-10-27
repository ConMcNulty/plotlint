import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { StateManager, loadRuntimeStateSnapshot, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import { checkSnapshot, checkText, evidenceCoverage, type ChapterTexts, type EvidenceCoverage, type TextRule } from "@plotlint/rules";
import { createHarperRule, isMostlyCjk, projectDictionary } from "@plotlint/mechanics";
import { generalPack } from "@plotlint/style/node";
import {
  applySuppressions,
  diagnosticFingerprint,
  DiagnosticLayerSchema,
  formatDiagnostic,
  type Diagnostic,
  type DiagnosticLayer,
  type Suppression,
} from "@plotlint/diagnostics";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";
import { addSuppression, loadSuppressions, removeSuppressions, suppressionsPath } from "@plotlint/diagnostics/node";

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
}

interface LintOptions {
  layers: ReadonlySet<DiagnosticLayer>;
  chapter?: number;
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

let generalPackRules: TextRule[] | undefined;

/** L0 (Harper) and L1 (the general style pack), as far as `layers` asks for them. */
function textRules(layers: ReadonlySet<DiagnosticLayer>): TextRule[] {
  const rules: TextRule[] = [];
  if (layers.has("mechanics")) rules.push(createHarperRule());
  if (layers.has("style")) rules.push(...(generalPackRules ??= generalPack()));
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
): Promise<LocatedDiagnostic[]> {
  const text = await readFile(path, "utf-8");
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

/** Run the checks over one book's state and chapter text and split the findings by its saved suppressions. */
async function lintBook(state: StateManager, id: string, options: LintOptions): Promise<BookLint> {
  const bookDir = state.bookDir(id);
  const { suppressions } = await loadSuppressions(bookDir);
  const snapshot = await loadSnapshot(bookDir);
  const inScope = (diagnostic: Diagnostic) =>
    options.layers.has(diagnostic.layer) && (options.chapter === undefined || diagnostic.chapter === options.chapter);

  const diagnostics: LocatedDiagnostic[] = snapshot ? checkSnapshot(snapshot).filter(inScope) : [];
  const files = await chapterFiles(bookDir);
  const chapters = options.chapter === undefined ? [...files.keys()] : files.has(options.chapter) ? [options.chapter] : [];
  const rules = textRules(options.layers);
  for (const chapter of chapters) diagnostics.push(...await lintChapterText(files.get(chapter)!, chapter, rules, snapshot));

  const { kept, suppressed } = applySuppressions(diagnostics, suppressions);
  return {
    id,
    diagnostics: kept.map(withFingerprint),
    suppressed: suppressed.map((entry) => ({ diagnostic: withFingerprint(entry.diagnostic), suppression: entry.suppression })),
    ...(snapshot ? {} : { stateMissing: true as const }),
    chapters,
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
