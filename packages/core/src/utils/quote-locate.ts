// plotlint: find where an LLM-quoted passage sits in a chapter.
//
// Models rarely copy text byte for byte: they straighten curly quotes, turn
// em dashes into hyphens, collapse line breaks, drop markdown emphasis, change
// the case of a first letter or elide the middle of a long passage with "...".
// Weaker models also drop or swap a word or two. `locateQuote` tolerates those
// changes, and always returns offsets into the original text, so
// `text.slice(start, end)` is the passage as the author wrote it.

export interface QuoteSpan {
  readonly start: number;
  readonly end: number;
}

export interface LocateQuoteOptions {
  /** Prefer the occurrence nearest this offset when the quote appears more than once. */
  readonly near?: number;
  /** Longest stretch an elided quote ("a ... b") may skip between its parts. Default 1500 characters. */
  readonly maxGap?: number;
  /** Fall back to a near-verbatim word alignment (at least 80% of 5+ words, in order). Default true. */
  readonly fuzzy?: boolean;
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
 * folded, a quote elided with "..." or "…" matches its parts in order, and
 * last a near-verbatim quote of five or more words matches the passage holding
 * at least 80% of its words in order.
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
  if (parts.length < 2) return options.fuzzy === false ? null : nearestFuzzy(text, haystack, needle, options.near);
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
  if (spans.length > 0) return nearest(spans, options.near);
  return options.fuzzy === false ? null : nearestFuzzy(text, haystack, needle, options.near);
}

// A near-verbatim quote: models drop words from the middle ("She walked home
// through ..." with a clause missing), add or lose a speech tag, or swap one word
// ("steps" for "stairs"). Align the quote's words in order against the text and
// accept the passage when nearly all of them are there, close together.
const WORD = /[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu;
const MIN_FUZZY_WORDS = 5;
const MIN_FUZZY_SHARE = 0.8;
// Words the text may have between two aligned quote words (a speech tag, a dropped clause).
const MAX_SKIP = 6;

interface Word {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function words(text: string): Word[] {
  return [...text.matchAll(WORD)].map((match) => ({ text: match[0], start: match.index!, end: match.index! + match[0].length }));
}

function nearestFuzzy(text: string, haystack: Folded, needle: string, near: number | undefined): QuoteSpan | null {
  const quote = words(needle).map((word) => word.text);
  if (quote.length < MIN_FUZZY_WORDS) return null;
  const textWords = words(haystack.text);
  const needed = Math.ceil(quote.length * MIN_FUZZY_SHARE);
  let best: { span: QuoteSpan; matched: number }[] = [];
  let bestMatched = needed - 1;

  // Start at each text word equal to one of the quote's first two words.
  for (let i = 0; i < textWords.length; i += 1) {
    const startAt = quote[0] === textWords[i]!.text ? 0 : quote[1] === textWords[i]!.text ? 1 : -1;
    if (startAt === -1) continue;
    let matched = 0;
    let cursor = i;
    let last = i;
    for (let q = startAt; q < quote.length; q += 1) {
      const limit = Math.min(textWords.length, cursor + MAX_SKIP + 1);
      let found = -1;
      for (let k = cursor; k < limit; k += 1) {
        if (textWords[k]!.text === quote[q]) {
          found = k;
          break;
        }
      }
      if (found === -1) continue; // a word the model changed or added
      matched += 1;
      last = found;
      cursor = found + 1;
    }
    if (matched < bestMatched) continue;
    const span = {
      start: haystack.map[textWords[i]!.start]!,
      end: unfold(text, haystack, textWords[last]!.end - 1, 1).end,
    };
    if (matched > bestMatched) best = [];
    bestMatched = matched;
    best.push({ span, matched });
  }
  return nearest(best.map((candidate) => candidate.span), near);
}
