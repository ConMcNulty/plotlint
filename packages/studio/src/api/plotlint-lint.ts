import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { StateManager, loadRuntimeStateSnapshot, loadWorkManifest, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import {
  applySuppressions,
  diagnosticFingerprint,
  type Diagnostic,
  type Suppression,
} from "@plotlint/diagnostics";
import { addSuppression, loadSuppressions } from "@plotlint/diagnostics/node";
import { checkParagraphs, paragraphRanges, projectDictionary } from "@plotlint/mechanics";
import {
  castBoard, checkSnapshot, checkText, configureTextRules, establishedAt, explainSeriesFindings, hookBoard, readRuleSetting, RuleRegistry, SeriesFileSchema, tensionView, timeline, withSeries,
  type CastMember, type HookBoard, type TensionView, type Timeline,
  type BookRuleData, type ChapterTexts, type EvidenceLocation, type RuleConfigFile, type RuleSetting, type TextDocument, type TextRule,
} from "@plotlint/rules";
import { loadAdaptiveOverlay, loadBookRuleData, loadSeriesPrelude, readPlotlintFile } from "@plotlint/rules/node";
import { createMetricRules, metricStateRules } from "@plotlint/metrics";
import { bookPacksDir, HARPER_RULE_ID, knownRuleIds, resolveBookPacks } from "@plotlint/packs/node";
import { chapterFiles } from "./plotlint-chapters.js";

/**
 * Chapter linting for the Studio editor: L0 Harper and L1 style rules of the
 * book's check packs (general plus `packs.json`) over the chapter text (whole, or
 * only the paragraphs an edit touched), the L2 metrics on whole-chapter lints,
 * plus the L3/L4 state findings for the chapter, with the book's suppressions applied.
 * Rule settings stack like `inkos lint`: packs, then the adaptive overlay from
 * the author's verdicts, then the book's `rules.json`.
 */

export interface LintTextRange {
  readonly start: number;
  readonly end: number;
}

export type FingerprintedDiagnostic = Diagnostic & {
  readonly fingerprint: string;
  /** For a finding with no range here: where the first fact it cites was established, to jump to. */
  readonly established?: EvidenceLocation;
};

export interface ChapterLintRequest {
  readonly bookDir: string;
  readonly chapter: number;
  readonly text: string;
  /**
   * Re-lint only these text ranges (expanded to whole paragraphs). Omit for the
   * whole chapter, which the editor does on open and after a save or suppression;
   * only a whole-chapter lint runs the L2 metrics, which measure the chapter as a whole.
   */
  readonly ranges?: ReadonlyArray<LintTextRange>;
}

export interface ChapterLintResult {
  readonly sourceId: string;
  /** Ranged L0/L1 findings inside `ranges` (or the whole text), then the chapter's unranged L3 findings. */
  readonly diagnostics: FingerprintedDiagnostic[];
  /** The ranges actually re-linted (whole paragraphs), or null for the whole text. Pass to the editor's `setDiagnostics`. */
  readonly ranges: LintTextRange[] | null;
  /** Findings hidden by suppressions in this result's scope. */
  readonly suppressed: number;
  /** The book has no runtime state yet: no project dictionary and no L3 findings. */
  readonly stateMissing: boolean;
  readonly timings: { readonly mechanicsMs: number; readonly styleMs: number; readonly metricsMs: number; readonly totalMs: number };
}

export const chapterSourceId = (chapter: number) => `chapter:${chapter}`;

interface BookState {
  readonly key: string;
  readonly chapters: ChapterTexts;
  readonly snapshot: RuntimeStateSnapshot | null;
  readonly dictionary: string[];
  /** The packs' style rules with the effective rule config (packs < adaptive overlay < rules.json) applied. */
  readonly styleRules: TextRule[];
  /** The L2 chapter metrics against the packs' bands, configured likewise. */
  readonly metricRules: TextRule[];
  /** Cross-chapter metrics (repeated phrases): enabled ones with their severity and options. */
  readonly metricStateRules: ReturnType<RuleRegistry["configure"]>;
  readonly book: BookRuleData;
  readonly config: RuleConfigFile;
  /** The L3 findings, checked on first use (navigation reads the snapshot without them). */
  stateDiagnostics(): Diagnostic[];
}

const STATE_FILES = ["state/manifest.json", "state/current_state.json", "state/hooks.json", "state/chapter_summaries.json"];
// The book's rule config, frames, packs and verdicts (the adaptive overlay), which change what the rules report.
const PLOTLINT_FILES = [
  "plotlint/rules.json", "plotlint/frames.json", "plotlint/packs.json", "plotlint/invariants.json", "plotlint/travel.json", "plotlint/verdicts.jsonl",
  "plotlint/scenes.json", "plotlint/hooks.json", "plotlint/series.json",
];
const bookStates = new Map<string, BookState>();

/**
 * The book's dictionary and L3 findings, cached until a state, plotlint or chapter
 * file changes, so a keystroke re-lint does not re-read and re-check the whole story state.
 * Rules read the saved chapter files (for frame markers), not the unsaved editor text.
 */
async function bookState(bookDir: string): Promise<BookState> {
  const chapters = await chapterFiles(bookDir);
  const stampsOf = (dir: string, files: ReadonlyArray<string>) => Promise.all(files.map(async (file) => {
    try {
      const info = await stat(join(dir, "story", file));
      return `${info.mtimeMs}:${info.size}`;
    } catch {
      return "-";
    }
  }));
  const stamps = await stampsOf(bookDir, [...STATE_FILES, ...PLOTLINT_FILES]);
  // A book in a series also changes when a book before it does.
  const earlier = (await readPlotlintFile(bookDir, "series.json", SeriesFileSchema).catch(() => undefined))?.after ?? [];
  const seriesStamps = (await Promise.all(earlier.map((id) => stampsOf(seriesBookDir(bookDir, id), [...STATE_FILES, "plotlint/invariants.json", "plotlint/travel.json"])))).flat();
  const key = [...stamps, ...seriesStamps, ...await bookPackStamps(bookDir)].join("|");
  const cached = bookStates.get(bookDir);
  if (cached?.key === key && cached.chapters === chapters) return cached;

  let snapshot: RuntimeStateSnapshot | null = null;
  try {
    snapshot = await loadRuntimeStateSnapshot(bookDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const loaded: BookRuleData = await loadBookRuleData(bookDir);
  // Like `inkos lint`: the packs, then the checks the author keeps rejecting lowered, then the book's own rules.json.
  const packs = resolveBookPacks(bookDir, loaded, knownRuleIds(), [await loadAdaptiveOverlay(bookDir)]);
  // Like `inkos lint`: a book in a series is checked against the end of the books before it.
  const prelude = await loadSeriesPrelude(bookDir, basename(dirname(bookDir)), async (id) => ({ bookDir: seriesBookDir(bookDir, id), title: await seriesTitle(bookDir, id) }));
  const series = prelude ? withSeries(snapshot ?? emptySnapshot(), { ...loaded, config: packs.config }, prelude) : undefined;
  if (series) snapshot = series.snapshot;
  const book: BookRuleData = series?.rules ?? { ...loaded, config: packs.config };
  const dictionary = snapshot ? projectDictionary(snapshot) : [];
  let checked: Diagnostic[] | undefined;
  const state: BookState = {
    key,
    chapters,
    snapshot,
    dictionary,
    styleRules: configureTextRules(packs.styleRules, packs.config),
    metricRules: configureTextRules(createMetricRules(packs.metrics), packs.config),
    metricStateRules: new RuleRegistry(metricStateRules({ names: dictionary, bands: packs.metrics })).configure(packs.config).filter(({ enabled }) => enabled),
    book,
    config: packs.config,
    stateDiagnostics: () => (checked ??= snapshot ? explainSeriesFindings(checkSnapshot(snapshot, { chapters, book }), series?.carried ?? []) : []),
  };
  bookStates.set(bookDir, state);
  return state;
}

/** Size and mtime of every file in the book's own packs (`story/plotlint/packs/`); a book without them has none. */
async function bookPackStamps(bookDir: string): Promise<string[]> {
  const dir = bookPacksDir(bookDir);
  let files: string[];
  try {
    files = (await readdir(dir, { recursive: true })).sort();
  } catch {
    return [];
  }
  return Promise.all(files.map(async (file) => {
    const info = await stat(join(dir, file)).catch(() => null);
    return info?.isFile() ? `${file}:${info.mtimeMs}:${info.size}` : file;
  }));
}

/**
 * The cross-chapter metrics for `chapter`, reading its unsaved `text` in place of
 * the saved file so the ranges fit the editor. They read only chapter text and
 * names, so a book without state still gets them.
 */
function metricStateFindings(state: BookState, chapter: number, text: string): Diagnostic[] {
  if (state.metricStateRules.length === 0) return [];
  const chapters = new Map(state.chapters);
  chapters.set(chapter, text);
  const found: Diagnostic[] = [];
  for (const { rule, severity, options } of state.metricStateRules) {
    const context = { snapshot: state.snapshot ?? ({} as RuntimeStateSnapshot), chapters, book: state.book, options };
    for (const diagnostic of rule.check(context)) {
      if (diagnostic.chapter === chapter) found.push(severity ? { ...diagnostic, severity } : diagnostic);
    }
  }
  return found;
}

/** Where a rangeless finding's first cited fact was established, when its passage is in a chapter today. */
function establishedFor(diagnostic: Diagnostic, chapters: ChapterTexts): EvidenceLocation | undefined {
  if (diagnostic.range) return undefined;
  for (const fact of diagnostic.facts ?? []) {
    const { location } = establishedAt(fact, chapters);
    if (location) return location;
  }
  return undefined;
}

// Books live at `<project>/works/<id>/source`, so the books before this one are its siblings.
const seriesBookDir = (bookDir: string, id: string) => join(dirname(dirname(bookDir)), id, "source");

async function seriesTitle(bookDir: string, id: string): Promise<string> {
  try {
    return (await new StateManager(dirname(dirname(dirname(bookDir)))).loadBookConfig(id)).title;
  } catch {
    try {
      return (await loadWorkManifest(dirname(dirname(dirname(bookDir))), id)).title;
    } catch {
      return id;
    }
  }
}

const emptySnapshot = (): RuntimeStateSnapshot => ({
  manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 0, projectionVersion: 1 },
  currentState: { chapter: 0, facts: [] },
  hooks: { hooks: [] },
  chapterSummaries: { rows: [] },
});

/** The book's runtime state snapshot (cached like the lint's), or null when it has none yet. */
export async function bookSnapshot(bookDir: string): Promise<RuntimeStateSnapshot | null> {
  return (await bookState(bookDir)).snapshot;
}

export interface BookBoards {
  /** The book has no runtime state yet, so there is nothing to draw. */
  readonly stateMissing: boolean;
  readonly hooks: HookBoard | null;
  readonly timeline: Timeline | null;
  readonly cast: CastMember[] | null;
  readonly tension: TensionView | null;
}

/**
 * The hook board and the timeline, from the same state and findings as the problems
 * panel (suppressions applied), so a board never shows what the editor hides.
 */
export async function bookBoards(bookDir: string): Promise<BookBoards> {
  const state = await bookState(bookDir);
  if (!state.snapshot) return { stateMissing: true, hooks: null, timeline: null, cast: null, tension: null };
  const findings = applySuppressions(state.stateDiagnostics(), (await loadSuppressions(bookDir)).suppressions).kept;
  const hemisphere = readRuleSetting(state.config.rules["continuity/timeline-order"]).options.hemisphere === "south" ? "south" : "north";
  return {
    stateMissing: false,
    hooks: hookBoard(state.snapshot, state.book.hooks, state.chapters, findings),
    timeline: timeline(state.snapshot, state.chapters, findings, hemisphere),
    cast: castBoard(state.snapshot, state.book.scenes?.scenes ?? [], findings),
    tension: tensionView(state.book.scenes?.scenes ?? [], findings),
  };
}

/** Expand ranges to the whole (blank-line separated) paragraphs they touch, merged and clamped. */
export function expandToParagraphs(text: string, ranges: ReadonlyArray<LintTextRange>): { ranges: LintTextRange[]; paragraphs: Array<[number, number]> } {
  const all = paragraphRanges(text);
  const expanded: LintTextRange[] = [];
  const paragraphs = new Set<number>();
  for (const range of ranges) {
    let start = Math.max(0, Math.min(range.start, text.length));
    let end = Math.max(start, Math.min(range.end, text.length));
    all.forEach(([from, to], index) => {
      // A paragraph is touched when it overlaps the range or the range sits on its edge.
      if (from <= end && to >= start) {
        paragraphs.add(index);
        start = Math.min(start, from);
        end = Math.max(end, to);
      }
    });
    expanded.push({ start, end });
  }
  expanded.sort((a, b) => a.start - b.start);
  const merged: LintTextRange[] = [];
  for (const range of expanded) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    else merged.push(range);
  }
  return { ranges: merged, paragraphs: [...paragraphs].sort((a, b) => a - b).map((index) => all[index]!) };
}

/** Style findings for `document.text.slice(range)`, with ranges in the whole document. */
async function styleInRange(document: TextDocument, range: LintTextRange, rules: ReadonlyArray<TextRule>, dictionary: ReadonlyArray<string>): Promise<Diagnostic[]> {
  const text = document.text.slice(range.start, range.end);
  if (!text.trim()) return [];
  const found = await checkText({ ...document, text }, rules, { dictionary });
  return found.map((diagnostic) => ({
    ...diagnostic,
    range: { ...diagnostic.range!, start: diagnostic.range!.start + range.start, end: diagnostic.range!.end + range.start },
  }));
}

const withFingerprint = (diagnostic: Diagnostic, chapters: ChapterTexts): FingerprintedDiagnostic => {
  const established = establishedFor(diagnostic, chapters);
  return { ...diagnostic, fingerprint: diagnosticFingerprint(diagnostic), ...(established ? { established } : {}) };
};

export async function lintChapter(request: ChapterLintRequest): Promise<ChapterLintResult> {
  const started = performance.now();
  const { bookDir, chapter, text } = request;
  const sourceId = chapterSourceId(chapter);
  const document: TextDocument = { sourceId, chapter, text };
  const [state, { suppressions }] = await Promise.all([bookState(bookDir), loadSuppressions(bookDir)]);
  const context = { document, dictionary: state.dictionary, ...(state.snapshot ? { snapshot: state.snapshot } : {}) };

  const partial = request.ranges ? expandToParagraphs(text, request.ranges) : null;

  const mechanicsStarted = performance.now();
  // Harper runs outside `checkText`, so its rule setting is applied to its findings.
  const harper = readRuleSetting(state.config.rules[HARPER_RULE_ID] as RuleSetting | undefined);
  const mechanics = !harper.enabled ? [] : (await checkParagraphs(context, partial ? partial.paragraphs : undefined))
    .map((diagnostic) => (harper.severity ? { ...diagnostic, severity: harper.severity } : diagnostic));
  const mechanicsMs = performance.now() - mechanicsStarted;

  // Style rules scope to sentences and paragraphs at most, so a partial lint runs
  // them over each re-linted run of whole paragraphs and shifts the ranges back.
  const styleStarted = performance.now();
  const style = partial
    ? (await Promise.all(partial.ranges.map((range) => styleInRange(document, range, state.styleRules, state.dictionary)))).flat()
    : await checkText(document, state.styleRules, { dictionary: state.dictionary });
  const styleMs = performance.now() - styleStarted;

  // Metrics measure the whole chapter (and repetition across chapters), so they run only on
  // whole-chapter lints; on a partial one the editor keeps the findings it has.
  const metricsStarted = performance.now();
  const metrics = partial ? [] : [
    ...await checkText(document, state.metricRules),
    ...metricStateFindings(state, chapter, text),
  ];
  const metricsMs = performance.now() - metricsStarted;

  const textDiagnostics = [...mechanics, ...style, ...metrics]
    .sort((a, b) => a.range!.start - b.range!.start || a.range!.end - b.range!.end || a.ruleId.localeCompare(b.ruleId));
  const stateDiagnostics = state.stateDiagnostics().filter((diagnostic) => diagnostic.chapter === chapter);

  const { kept, suppressed } = applySuppressions([...textDiagnostics, ...stateDiagnostics], suppressions);
  return {
    sourceId,
    diagnostics: kept.map((diagnostic) => withFingerprint(diagnostic, state.chapters)),
    ranges: partial ? partial.ranges : null,
    suppressed: suppressed.length,
    stateMissing: state.snapshot === null,
    timings: { mechanicsMs, styleMs, metricsMs, totalMs: performance.now() - started },
  };
}

export interface SuppressionRequest {
  readonly ruleId: string;
  readonly reason: string;
  /** Suppress one finding; omit to turn the rule off for the whole book. */
  readonly fingerprint?: string;
  readonly chapter?: number;
  readonly quote?: string;
  readonly author?: string;
}

/** Save "mark as intentional" (an instance) or "turn this check off" (rule-wide) to the book's suppressions file. */
export async function suppressFinding(bookDir: string, request: SuppressionRequest): Promise<{ suppression: Suppression; replaced: boolean }> {
  const createdAt = new Date().toISOString();
  const author = request.author?.trim() ? { author: request.author.trim() } : {};
  const suppression: Suppression = request.fingerprint
    ? {
      kind: "instance",
      ruleId: request.ruleId,
      fingerprint: request.fingerprint,
      reason: request.reason,
      createdAt,
      ...author,
      ...(request.chapter === undefined ? {} : { chapter: request.chapter }),
      ...(request.quote ? { quote: request.quote } : {}),
    }
    : { kind: "rule", ruleId: request.ruleId, reason: request.reason, createdAt, ...author };
  const { replaced } = await addSuppression(bookDir, suppression);
  return { suppression, replaced };
}

const MAX_LINT_TEXT = 2_000_000;

/** Parse and validate a lint request body; returns an error message for a bad one. */
export function parseLintBody(body: unknown): { bookId: string; chapter: number; text: string; ranges?: LintTextRange[] } | string {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  const { bookId, chapter, text, ranges } = body as Record<string, unknown>;
  if (typeof bookId !== "string") return "bookId must be a string";
  if (typeof chapter !== "number" || !Number.isInteger(chapter) || chapter < 0) return "chapter must be a non-negative integer";
  if (typeof text !== "string") return "text must be a string";
  if (text.length > MAX_LINT_TEXT) return `text is longer than ${MAX_LINT_TEXT} characters`;
  if (ranges === undefined || ranges === null) return { bookId, chapter, text };
  if (!Array.isArray(ranges)) return "ranges must be an array";
  const parsed: LintTextRange[] = [];
  for (const range of ranges) {
    const { start, end } = (range ?? {}) as Record<string, unknown>;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end < start || end > text.length) {
      return "each range needs integer start <= end within the text";
    }
    parsed.push({ start, end });
  }
  return { bookId, chapter, text, ranges: parsed };
}

export function parseSuppressionBody(body: unknown): ({ bookId: string } & SuppressionRequest) | string {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  const { bookId, ruleId, reason, fingerprint, chapter, quote, author } = body as Record<string, unknown>;
  if (typeof bookId !== "string") return "bookId must be a string";
  if (typeof ruleId !== "string" || !ruleId.trim()) return "ruleId must be a non-empty string";
  if (typeof reason !== "string" || !reason.trim()) return "reason must be a non-empty string";
  if (fingerprint !== undefined && (typeof fingerprint !== "string" || !fingerprint)) return "fingerprint must be a non-empty string";
  if (chapter !== undefined && (typeof chapter !== "number" || !Number.isInteger(chapter) || chapter < 0)) return "chapter must be a non-negative integer";
  if (quote !== undefined && typeof quote !== "string") return "quote must be a string";
  if (author !== undefined && typeof author !== "string") return "author must be a string";
  return {
    bookId,
    ruleId: ruleId.trim(),
    reason: reason.trim(),
    ...(fingerprint ? { fingerprint } : {}),
    ...(chapter === undefined ? {} : { chapter }),
    ...(quote ? { quote: quote.slice(0, 500) } : {}),
    ...(author ? { author } : {}),
  };
}

