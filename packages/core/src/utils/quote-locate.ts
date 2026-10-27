// plotlint: find where an LLM-quoted passage sits in a chapter.
//
// Models rarely copy text byte for byte: they straighten curly quotes, turn
// em dashes into hyphens, collapse line breaks, drop markdown emphasis, change
// the case of a first letter or elide the middle of a long passage with "...".
// `locateQuote` tolerates exactly those changes and nothing else, and always
// returns offsets into the original text, so `text.slice(start, end)` is the
// passage as the author wrote it.

export interface QuoteSpan {
  readonly start: number;
  readonly end: number;
}

export interface LocateQuoteOptions {
  /** Prefer the occurrence nearest this offset when the quote appears more than once. */
  readonly near?: number;
  /** Longest stretch an elided quote ("a ... b") may skip between its parts. Default 1500 characters. */
  readonly maxGap?: number;
}

const FOLD: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "`": "'",
  "“": "\"", "”": "\"", "„": "\"", "‟": "\"", "″": "\"", "«": "\"", "»": "\"",
  "「": "\"", "」": "\"", "『": "\"", "』": "\"",
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-", "⸺": "-",
  " ": " ", "　": " ",
};

// Markdown emphasis markers are dropped on both sides.
const DROPPED = new Set(["*", "_"]);

interface Folded {
  readonly text: string;
  /** Original index of each folded character. */
  readonly map: ReadonlyArray<number>;
}

function fold(text: string): Folded {
  let out = "";
  const map: number[] = [];
  let lastWasSpace = true;
  for (let index = 0; index < text.length; index += 1) {
    let char = text[index]!;
    if (DROPPED.has(char)) continue;
    // "…" and "..." both become "…" so elision splitting sees one marker.
    if (char === "." && text.startsWith("...", index)) {
      out += "…";
      map.push(index);
      index += 2;
      lastWasSpace = false;
      continue;
    }
    // A dash written as two hyphens ("--") folds like an em dash.
    if (char === "-" && text[index + 1] === "-") {
      out += "-";
      map.push(index);
      index += 1;
      lastWasSpace = false;
      continue;
    }
    char = FOLD[char] ?? char;
    if (/\s/u.test(char)) {
      if (lastWasSpace) continue;
      out += " ";
      map.push(index);
      lastWasSpace = true;
      continue;
    }
    const lower = char.toLowerCase();
    // Keep the one-to-one map: skip case folding that changes length ("İ").
    out += lower.length === 1 ? lower : char;
    map.push(index);
    lastWasSpace = false;
  }
  return { text: out, map };
}

function occurrences(haystack: string, needle: string, from = 0): number[] {
  const found: number[] = [];
  if (!needle) return found;
  for (let at = haystack.indexOf(needle, from); at !== -1; at = haystack.indexOf(needle, at + 1)) found.push(at);
  return found;
}

function nearest(candidates: ReadonlyArray<QuoteSpan>, near: number | undefined): QuoteSpan | null {
  if (candidates.length === 0) return null;
  if (near === undefined) return candidates[0]!;
  return candidates.reduce((best, span) => Math.abs(span.start - near) < Math.abs(best.start - near) ? span : best);
}

/** Map a folded range back to the original text, ending after the last matched original character. */
function unfold(text: string, folded: Folded, start: number, length: number): QuoteSpan {
  const last = folded.map[start + length - 1]!;
  let end = last + 1;
  // A folded "…" may stand for "..." and a folded "-" for "--".
  if (folded.text[start + length - 1] === "…" && text.startsWith("...", last)) end = last + 3;
  else if (text[last] === "-" && text[last + 1] === "-") end = last + 2;
  return { start: folded.map[start]!, end };
}

/** Drop surrounding spaces and quote marks: models often add or lose the dialogue quotes around a line. */
function trimFolded(text: string): string {
  return text.replace(/^[\s"']+|[\s"']+$/gu, "");
}

/**
 * Find `quote` in `text` and return its offsets, or null when it is not there.
 * Exact matches win; otherwise quotes, dashes, whitespace, emphasis and case are
 * folded, and a quote elided with "..." or "…" matches its parts in order.
 */
export function locateQuote(text: string, quote: string, options: LocateQuoteOptions = {}): QuoteSpan | null {
  const trimmed = quote.trim();
  if (!trimmed) return null;

  const exact = occurrences(text, trimmed).map((start) => ({ start, end: start + trimmed.length }));
  if (exact.length > 0) return nearest(exact, options.near);

  const haystack = fold(text);
  const needle = trimFolded(fold(trimmed).text);
  if (!needle) return null;

  const whole = occurrences(haystack.text, needle).map((at) => unfold(text, haystack, at, needle.length));
  if (whole.length > 0) return nearest(whole, options.near);

  // An elided quote: match each part in order, each within maxGap of the last.
  const parts = needle.split("…").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  const maxGap = options.maxGap ?? 1500;
  const spans: QuoteSpan[] = [];
  for (const first of occurrences(haystack.text, parts[0]!)) {
    let cursor = first + parts[0]!.length;
    let ok = true;
    for (const part of parts.slice(1)) {
      const next = haystack.text.indexOf(part, cursor);
      if (next === -1 || next - cursor > maxGap) {
        ok = false;
        break;
      }
      cursor = next + part.length;
    }
    if (ok) spans.push({ start: haystack.map[first]!, end: unfold(text, haystack, cursor - 1, 1).end });
  }
  return nearest(spans, options.near);
}
