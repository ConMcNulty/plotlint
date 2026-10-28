import { locateQuote } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import { proseParagraphs, sentences } from "@plotlint/metrics";
import { segmentScenes } from "@plotlint/rules";
import type { Edit, EditScope, Span } from "./types.js";

// Where findings sit in the draft, how far the author may edit around them, and
// applying the author's edits. Offsets are UTF-16 units of the current draft.

const normalize = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
// Metric findings restate their measured value every round ("MTLD 64"), so numbers are not part of a finding's identity.
const withoutNumbers = (value: string) => value.replace(/\d+(?:\.\d+)?%?/gu, "#");

/**
 * Where a finding points in the draft: its range when it has one, else the first of
 * its quotes (source refs, then the evidence of facts established in this chapter)
 * that can be found in the text.
 */
export function findingSpan(diagnostic: Diagnostic, text: string): Span | undefined {
  if (diagnostic.range && diagnostic.range.end <= text.length) return { start: diagnostic.range.start, end: diagnostic.range.end };
  const quotes = [
    ...(diagnostic.sourceRefs ?? []).map((ref) => ref.quote),
    ...(diagnostic.facts ?? []).filter((fact) => fact.sourceChapter === diagnostic.chapter).flatMap((fact) =>
      [fact.evidence?.quote, fact.endEvidence?.quote].filter((quote): quote is string => Boolean(quote))),
  ];
  for (const quote of quotes) {
    const span = locateQuote(text, quote);
    if (span) return { start: span.start, end: span.end };
  }
  return undefined;
}

/**
 * Identity of a finding across rounds: the rule, its code and the flagged words, or
 * its summary without numbers when it flags the whole chapter. Offsets are left out,
 * since edits elsewhere move them.
 */
export function findingKey(diagnostic: Diagnostic, text: string): string {
  const span = findingSpan(diagnostic, text);
  const what = span && span.end > span.start ? `q:${normalize(text.slice(span.start, span.end))}` : `s:${withoutNumbers(normalize(diagnostic.summary))}`;
  return [diagnostic.ruleId, diagnostic.code ?? "", diagnostic.chapter ?? "book", what].join("\u0000");
}

const containing = (spans: ReadonlyArray<Span>, at: Span): Span | undefined =>
  spans.find((span) => span.start <= at.start && at.end <= span.end)
  ?? spans.find((span) => span.start < Math.max(at.end, at.start + 1) && span.end > at.start);

/** The smallest unit of `scope` around `span` (both when `span` straddles two units: their union). */
export function editRegion(text: string, span: Span | undefined, scope: EditScope, chapter = 0): Span | undefined {
  if (scope === "chapter") return { start: 0, end: text.length };
  if (!span) return undefined;
  if (scope === "span") return span;
  const units: ReadonlyArray<Span> = scope === "sentence" ? sentences(text)
    : scope === "paragraph" ? proseParagraphs(text)
    : segmentScenes(text, { chapter });
  const first = containing(units, { start: span.start, end: span.start });
  const last = containing(units, { start: Math.max(span.start, span.end - 1), end: Math.max(span.start, span.end - 1) });
  if (!first && !last) return span;
  return { start: Math.min(first?.start ?? span.start, span.start), end: Math.max(last?.end ?? span.end, span.end) };
}

export interface PlacedEdit extends Edit {
  readonly span: Span;
}

export type EditProblem = "not-found" | "ambiguous" | "outside-region" | "overlaps" | "no-op";

/**
 * Find each edit's text in the draft. `find` must occur exactly once (after the
 * longest-first expansion an author's quote may need) and lie inside `region`.
 */
export function placeEdit(text: string, edit: Edit, region: Span | undefined): PlacedEdit | EditProblem {
  if (edit.find === edit.replace) return "no-op";
  if (!edit.find) return "not-found";
  const first = text.indexOf(edit.find);
  if (first < 0) return "not-found";
  let at = first;
  if (text.indexOf(edit.find, first + 1) >= 0) {
    // Twice in the chapter: unambiguous only if exactly one occurrence is inside the region.
    if (!region) return "ambiguous";
    const inside: number[] = [];
    for (let index = first; index >= 0; index = text.indexOf(edit.find, index + 1)) {
      if (index >= region.start && index + edit.find.length <= region.end) inside.push(index);
    }
    if (inside.length !== 1) return inside.length === 0 ? "outside-region" : "ambiguous";
    at = inside[0]!;
  }
  const span = { start: at, end: at + edit.find.length };
  if (!region || span.start < region.start || span.end > region.end) return "outside-region";
  return { ...edit, span };
}

/** Apply placed edits that do not overlap; returns the new text and, per edit, where its replacement now sits. */
export function applyEdits(text: string, edits: ReadonlyArray<PlacedEdit>): { text: string; changed: Span[] } {
  const ordered = [...edits].sort((a, b) => a.span.start - b.span.start);
  let out = "";
  let cursor = 0;
  const changed: Span[] = [];
  for (const edit of ordered) {
    out += text.slice(cursor, edit.span.start);
    changed.push({ start: out.length, end: out.length + edit.replace.length });
    out += edit.replace;
    cursor = edit.span.end;
  }
  return { text: out + text.slice(cursor), changed };
}

export const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
/** Overlap for scope tests, where an empty span (a deletion) still touches its neighbours. */
export const touches = (a: Span, b: Span) => a.start <= b.end && b.start <= a.end;

/** Map an offset in the text before `edits` to the text after them. Offsets inside an edit move to its end. */
export function shiftOffset(offset: number, edits: ReadonlyArray<PlacedEdit>): number {
  let delta = 0;
  for (const edit of [...edits].sort((a, b) => a.span.start - b.span.start)) {
    if (edit.span.end <= offset) delta += edit.replace.length - (edit.span.end - edit.span.start);
    else if (edit.span.start < offset) return edit.span.start + delta + edit.replace.length;
  }
  return offset + delta;
}

/** The scenes (in the new text) that the changed spans fall in: what editors rerun on. */
export function changedScenes(text: string, changed: ReadonlyArray<Span>, chapter = 0): Span[] {
  const scenes = segmentScenes(text, { chapter });
  return scenes.filter((scene) => changed.some((span) => touches(scene, span))).map((scene) => ({ start: scene.start, end: scene.end }));
}
