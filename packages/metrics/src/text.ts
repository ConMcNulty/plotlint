/**
 * Tokenising manuscript text for the metrics. Every unit keeps its offsets in the
 * original text, CRLF included, so findings can be drawn as ranges.
 */

/** A span of the original text: `[start, end)` in UTF-16 units. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Word extends Span {
  /** Lowercased, with curly apostrophes folded to straight ones. */
  readonly norm: string;
}

export interface Paragraph extends Span {
  /** Index among the prose paragraphs of the chapter. */
  readonly index: number;
}

export interface Sentence extends Span {
  readonly words: number;
  /** True when part of the sentence is inside quotation marks. */
  readonly dialogue: boolean;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const LATIN = /\p{Script=Latin}/gu;

/** True when most letters are CJK. The metrics are English-only, so such text is skipped. */
export function isMostlyCjk(text: string): boolean {
  const cjk = text.match(CJK)?.length ?? 0;
  return cjk > 0 && cjk >= (text.match(LATIN)?.length ?? 0);
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

/** Words of `text` (letters and digits, with inner apostrophes), offset by `base`. */
export function words(text: string, base = 0): Word[] {
  return [...text.matchAll(WORD)].map((match) => ({
    start: base + match.index,
    end: base + match.index + match[0].length,
    norm: match[0].toLowerCase().replace(/’/gu, "'"),
  }));
}

/** Words of the chapter's prose paragraphs only, so headings and scene breaks do not count. */
export function proseWords(text: string, paragraphs: ReadonlyArray<Paragraph> = proseParagraphs(text)): Word[] {
  return paragraphs.flatMap((paragraph) => words(text.slice(paragraph.start, paragraph.end), paragraph.start));
}

// Markdown headings, scene-break markers (`***`, `#`, `~`) and front matter fences are not prose.
const NOT_PROSE = /^(?:#{1,6}\s.*|[-*_~#=•·\s]+|---)$/u;

/**
 * Prose paragraphs: blocks between blank lines, trimmed, without Markdown headings
 * or scene-break lines. A paragraph holding several lines stays one paragraph.
 */
export function proseParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const blank = /\n[ \t\r]*\n/gu;
  let from = 0;
  const push = (start: number, end: number) => {
    const block = text.slice(start, end);
    const lead = block.length - block.trimStart().length;
    const trimmed = block.trim();
    if (!trimmed || NOT_PROSE.test(trimmed) || !/[\p{L}]/u.test(trimmed)) return;
    paragraphs.push({ start: start + lead, end: start + lead + trimmed.length, index: paragraphs.length });
  };
  for (const match of text.matchAll(blank)) {
    push(from, match.index);
    from = match.index + match[0].length;
  }
  push(from, text.length);
  // A heading line glued to the first paragraph (no blank line after it) is dropped from that paragraph.
  return paragraphs.flatMap((paragraph) => {
    const block = text.slice(paragraph.start, paragraph.end);
    const heading = block.match(/^#{1,6}\s[^\n]*\n\s*/u);
    if (!heading) return [paragraph];
    const start = paragraph.start + heading[0].length;
    return start < paragraph.end ? [{ ...paragraph, start }] : [];
  }).map((paragraph, index) => ({ ...paragraph, index }));
}

/**
 * Quoted spans (dialogue) inside one paragraph, offsets into the full text.
 * Double quotes, straight or curly, always count. Single curly quotes count when
 * the text uses them for speech (British style, see `usesSingleQuotes`); straight
 * single quotes are left alone, since they cannot be told apart from apostrophes.
 * An unclosed quote runs to the end of the paragraph, the convention for speech
 * that goes on into the next paragraph.
 */
export function quoteSpans(text: string, paragraph: Span, singleQuotes = false): Span[] {
  const block = text.slice(paragraph.start, paragraph.end);
  const spans: Span[] = [];
  let open: number | undefined;
  for (let i = 0; i < block.length; i++) {
    const char = block[i]!;
    const before = i > 0 ? block[i - 1]! : " ";
    const after = i + 1 < block.length ? block[i + 1]! : " ";
    let opens = false;
    let closes = false;
    if (char === "“") opens = true;
    else if (char === "”") closes = true;
    else if (char === "\"") {
      if (open === undefined) opens = true;
      else closes = true;
    } else if (singleQuotes && char === "‘" && !/[\p{L}\p{N}]/u.test(before)) opens = true;
    else if (singleQuotes && char === "’" && open !== undefined && !/[\p{L}\p{N}]/u.test(after)) {
      // `’` inside a word or after `s` ("the girls’ coats") is an apostrophe, unless it ends the quote.
      closes = true;
    }
    if (opens) {
      if (open !== undefined && char === "“") continue; // a stray second opener: keep the first
      open = i;
    } else if (closes && open !== undefined) {
      spans.push({ start: paragraph.start + open, end: paragraph.start + i + 1 });
      open = undefined;
    }
  }
  if (open !== undefined) spans.push({ start: paragraph.start + open, end: paragraph.end });
  return spans;
}

/** True when the text marks speech with single curly quotes and no double quotes. */
export function usesSingleQuotes(text: string): boolean {
  if (/["“”]/u.test(text)) return false;
  return /(?:^|[\s(—–-])‘\p{L}/u.test(text);
}

/** Every quoted span in the prose paragraphs, in order. */
export function dialogueSpans(text: string, paragraphs: ReadonlyArray<Paragraph> = proseParagraphs(text)): Span[] {
  const single = usesSingleQuotes(text);
  return paragraphs.flatMap((paragraph) => quoteSpans(text, paragraph, single));
}

// Abbreviations whose period does not end a sentence.
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "st", "mt", "messrs", "mme", "mlle", "prof", "rev", "hon", "capt", "col", "gen", "lt", "sgt", "sr", "jr",
  "vs", "etc", "e.g", "i.e", "no", "vol", "ch", "fig", "p", "pp",
]);

const isUpperOrQuoteStart = (char: string | undefined) => char !== undefined && /[\p{Lu}\p{N}"“‘'(\[—–-]/u.test(char);

/**
 * Sentences of the prose paragraphs. A sentence ends at `.`, `!`, `?` or `…` (and any
 * closing quotes or brackets after it) followed by whitespace and a capital or an
 * opening quote, or at the end of a paragraph. Titles such as "Mr." and single
 * initials do not end one.
 */
export function sentences(text: string, paragraphs: ReadonlyArray<Paragraph> = proseParagraphs(text), dialogue?: ReadonlyArray<Span>): Sentence[] {
  const spans = dialogue ?? dialogueSpans(text, paragraphs);
  const result: Sentence[] = [];
  const push = (start: number, end: number) => {
    const slice = text.slice(start, end);
    const lead = slice.length - slice.trimStart().length;
    const trimmed = slice.trim();
    if (!trimmed) return;
    const s = start + lead;
    const e = s + trimmed.length;
    const count = words(trimmed).length;
    if (count === 0) return;
    result.push({ start: s, end: e, words: count, dialogue: spans.some((span) => span.start < e && span.end > s) });
  };
  for (const paragraph of paragraphs) {
    let from = paragraph.start;
    const block = text.slice(paragraph.start, paragraph.end);
    const terminal = /[.!?…]+["”’')\]]*(?=\s)/gu;
    for (const match of block.matchAll(terminal)) {
      const endLocal = match.index + match[0].length;
      const rest = block.slice(endLocal);
      const next = rest.trimStart()[0];
      if (!isUpperOrQuoteStart(next)) continue;
      if (match[0].startsWith(".") && match[0].length === 1) {
        const wordBefore = block.slice(0, match.index).match(/([\p{L}.]+)$/u)?.[1]?.toLowerCase() ?? "";
        if (ABBREVIATIONS.has(wordBefore) || /^\p{L}$/u.test(wordBefore)) continue;
      }
      push(from, paragraph.start + endLocal);
      from = paragraph.start + endLocal;
    }
    push(from, paragraph.end);
  }
  return result;
}
