import { stat } from "node:fs/promises";
import { join } from "node:path";
import { loadRuntimeStateSnapshot, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import {
  applySuppressions,
  diagnosticFingerprint,
  type Diagnostic,
  type Suppression,
} from "@plotlint/diagnostics";
import { addSuppression, loadSuppressions } from "@plotlint/diagnostics/node";
import { checkParagraphs, paragraphRanges, projectDictionary } from "@plotlint/mechanics";
import { checkSnapshot, checkText, type TextDocument, type TextRule } from "@plotlint/rules";
import { generalPack } from "@plotlint/style/node";

/**
 * Chapter linting for the Studio editor: L0 Harper and L1 general-pack style
 * rules over the chapter text (whole, or only the paragraphs an edit touched),
 * plus the L3 state findings for the chapter, with the book's suppressions applied.
 */

export interface LintTextRange {
  readonly start: number;
  readonly end: number;
}

export type FingerprintedDiagnostic = Diagnostic & { readonly fingerprint: string };

export interface ChapterLintRequest {
  readonly bookDir: string;
  readonly chapter: number;
  readonly text: string;
  /** Re-lint only these text ranges (expanded to whole paragraphs). Omit for the whole chapter. */
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
  readonly timings: { readonly mechanicsMs: number; readonly styleMs: number; readonly totalMs: number };
}

export const chapterSourceId = (chapter: number) => `chapter:${chapter}`;

let stylePack: TextRule[] | undefined;
/** The general style pack, read from disk once per process. */
function styleRules(): TextRule[] {
  stylePack ??= generalPack();
  return stylePack;
}

interface BookState {
  readonly key: string;
  readonly snapshot: RuntimeStateSnapshot | null;
  readonly dictionary: string[];
  /** The L3 findings, checked on first use (navigation reads the snapshot without them). */
  stateDiagnostics(): Diagnostic[];
}

const STATE_FILES = ["manifest.json", "current_state.json", "hooks.json", "chapter_summaries.json"];
const bookStates = new Map<string, BookState>();

/**
 * The book's dictionary and L3 findings, cached until a state file changes, so a
 * keystroke re-lint does not re-read and re-check the whole story state.
 */
async function bookState(bookDir: string): Promise<BookState> {
  const stateDir = join(bookDir, "story", "state");
  const stamps = await Promise.all(STATE_FILES.map(async (file) => {
    try {
      const info = await stat(join(stateDir, file));
      return `${info.mtimeMs}:${info.size}`;
    } catch {
      return "-";
    }
  }));
  const key = stamps.join("|");
  const cached = bookStates.get(bookDir);
  if (cached?.key === key) return cached;

  let snapshot: RuntimeStateSnapshot | null = null;
  try {
    snapshot = await loadRuntimeStateSnapshot(bookDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let checked: Diagnostic[] | undefined;
  const state: BookState = {
    key,
    snapshot,
    dictionary: snapshot ? projectDictionary(snapshot) : [],
    stateDiagnostics: () => (checked ??= snapshot ? checkSnapshot(snapshot) : []),
  };
  bookStates.set(bookDir, state);
  return state;
}

/** The book's runtime state snapshot (cached like the lint's), or null when it has none yet. */
export async function bookSnapshot(bookDir: string): Promise<RuntimeStateSnapshot | null> {
  return (await bookState(bookDir)).snapshot;
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
async function styleInRange(document: TextDocument, range: LintTextRange, dictionary: ReadonlyArray<string>): Promise<Diagnostic[]> {
  const text = document.text.slice(range.start, range.end);
  if (!text.trim()) return [];
  const found = await checkText({ ...document, text }, styleRules(), { dictionary });
  return found.map((diagnostic) => ({
    ...diagnostic,
    range: { ...diagnostic.range!, start: diagnostic.range!.start + range.start, end: diagnostic.range!.end + range.start },
  }));
}

const withFingerprint = (diagnostic: Diagnostic): FingerprintedDiagnostic =>
  ({ ...diagnostic, fingerprint: diagnosticFingerprint(diagnostic) });

export async function lintChapter(request: ChapterLintRequest): Promise<ChapterLintResult> {
  const started = performance.now();
  const { bookDir, chapter, text } = request;
  const sourceId = chapterSourceId(chapter);
  const document: TextDocument = { sourceId, chapter, text };
  const [state, { suppressions }] = await Promise.all([bookState(bookDir), loadSuppressions(bookDir)]);
  const context = { document, dictionary: state.dictionary, ...(state.snapshot ? { snapshot: state.snapshot } : {}) };

  const partial = request.ranges ? expandToParagraphs(text, request.ranges) : null;

  const mechanicsStarted = performance.now();
  const mechanics = await checkParagraphs(context, partial ? partial.paragraphs : undefined);
  const mechanicsMs = performance.now() - mechanicsStarted;

  // Style rules scope to sentences and paragraphs at most, so a partial lint runs
  // them over each re-linted run of whole paragraphs and shifts the ranges back.
  const styleStarted = performance.now();
  const style = partial
    ? (await Promise.all(partial.ranges.map((range) => styleInRange(document, range, state.dictionary)))).flat()
    : await checkText(document, styleRules(), { dictionary: state.dictionary });
  const styleMs = performance.now() - styleStarted;

  const textDiagnostics = [...mechanics, ...style]
    .sort((a, b) => a.range!.start - b.range!.start || a.range!.end - b.range!.end || a.ruleId.localeCompare(b.ruleId));
  const stateDiagnostics = state.stateDiagnostics().filter((diagnostic) => diagnostic.chapter === chapter);

  const { kept, suppressed } = applySuppressions([...textDiagnostics, ...stateDiagnostics], suppressions);
  return {
    sourceId,
    diagnostics: kept.map(withFingerprint),
    ranges: partial ? partial.ranges : null,
    suppressed: suppressed.length,
    stateMissing: state.snapshot === null,
    timings: { mechanicsMs, styleMs, totalMs: performance.now() - started },
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

