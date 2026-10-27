import { senseOf, SENSES, type Sense } from "./sensory.js";
import {
  dialogueSpans, isMostlyCjk, proseParagraphs, proseWords, sentences, words, type Paragraph, type Sentence, type Span,
} from "./text.js";

/**
 * MTLD, the measure of textual lexical diversity (McCarthy and Jarvis 2010): the
 * mean length of runs of tokens that keep the type-token ratio above `threshold`
 * (0.72 by convention). Each pass counts a factor every time the running TTR
 * falls to the threshold, then a partial factor for the remainder; MTLD is the
 * token count over the factors, averaged over a forward and a backward pass.
 * Unlike plain TTR it hardly depends on text length. Returns null for no tokens.
 */
export function mtld(tokens: ReadonlyArray<string>, threshold = 0.72): number | null {
  if (tokens.length === 0) return null;
  const pass = (sequence: ReadonlyArray<string>) => {
    let factors = 0;
    let types = new Set<string>();
    let count = 0;
    for (const token of sequence) {
      types.add(token);
      count++;
      if (types.size / count <= threshold) {
        factors++;
        types = new Set();
        count = 0;
      }
    }
    if (count > 0) factors += (1 - types.size / count) / (1 - threshold);
    // A text that never repeats a word has no factor at all; its diversity is its length.
    return factors === 0 ? sequence.length : sequence.length / factors;
  };
  return (pass(tokens) + pass([...tokens].reverse())) / 2;
}

export interface FlatStretch extends Span {
  /** Index of the first and one past the last sentence of the stretch. */
  readonly fromSentence: number;
  readonly toSentence: number;
  /** The lowest coefficient of variation of any window inside the stretch. */
  readonly cv: number;
  readonly meanWords: number;
}

export interface Rhythm {
  readonly lengths: number[];
  readonly mean: number;
  readonly stdev: number;
  /** Standard deviation over mean: how much sentence length varies. */
  readonly cv: number;
  /** The lowest window CV in the chapter (narrative windows only), or null when no window fits. */
  readonly flattestWindowCv: number | null;
  readonly flat: FlatStretch[];
}

export interface RhythmOptions {
  /** Sentences per window. */
  readonly window?: number;
  /** A window whose CV is below this is flat. */
  readonly windowCv?: number;
}

function stats(values: ReadonlyArray<number>): { mean: number; stdev: number; cv: number } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const stdev = Math.sqrt(variance);
  return { mean, stdev, cv: mean === 0 ? 0 : stdev / mean };
}

/**
 * Sentence lengths in words, their mean, standard deviation and coefficient of
 * variation, and flat stretches: runs of `window` (8) or more consecutive
 * sentences whose lengths barely vary (window CV below `windowCv`). Windows where
 * half or more of the sentences carry dialogue are skipped, since quick exchanges
 * of short lines are a rhythm of their own. Overlapping flat windows merge into
 * one stretch. Returns null for fewer than two sentences.
 */
export function sentenceRhythm(list: ReadonlyArray<Sentence>, options: RhythmOptions = {}): Rhythm | null {
  if (list.length < 2) return null;
  const window = options.window ?? 8;
  const windowCv = options.windowCv ?? 0.2;
  const lengths = list.map((sentence) => sentence.words);
  const { mean, stdev, cv } = stats(lengths);
  let flattest: number | null = null;
  const flat: FlatStretch[] = [];
  for (let i = 0; i + window <= list.length; i++) {
    const slice = list.slice(i, i + window);
    if (slice.filter((sentence) => sentence.dialogue).length * 2 >= window) continue;
    const window_ = stats(slice.map((sentence) => sentence.words));
    flattest = flattest === null ? window_.cv : Math.min(flattest, window_.cv);
    if (window_.cv >= windowCv) continue;
    const last = flat.at(-1);
    if (last && i < last.toSentence) {
      const merged = list.slice(last.fromSentence, i + window);
      flat[flat.length - 1] = {
        ...last, end: list[i + window - 1]!.end, toSentence: i + window, cv: Math.min(last.cv, window_.cv),
        meanWords: stats(merged.map((sentence) => sentence.words)).mean,
      };
    } else {
      flat.push({ start: slice[0]!.start, end: slice.at(-1)!.end, fromSentence: i, toSentence: i + window, cv: window_.cv, meanWords: window_.mean });
    }
  }
  return { lengths, mean, stdev, cv, flattestWindowCv: flattest, flat };
}

export interface DialogueRatio {
  /** Words inside quotation marks over all prose words, 0 to 1. */
  readonly ratio: number;
  readonly dialogueWords: number;
  readonly words: number;
}

const wordCount = (text: string, span: Span) => words(text.slice(span.start, span.end)).length;

/** Share of the prose's words that sit inside quotation marks (see `quoteSpans` for which marks count). */
export function dialogueRatio(text: string, paragraphs: ReadonlyArray<Paragraph> = proseParagraphs(text), spans = dialogueSpans(text, paragraphs)): DialogueRatio {
  const total = proseWords(text, paragraphs).length;
  const inside = spans.reduce((sum, span) => sum + wordCount(text, span), 0);
  return { ratio: total === 0 ? 0 : inside / total, dialogueWords: inside, words: total };
}

export interface SensoryDensity {
  /** Sensory words per 1000 prose words, all senses together. */
  readonly perThousand: number;
  readonly bySense: Record<Sense, number>;
  readonly count: number;
  readonly words: number;
}

/** Sensory-detail density: words from the per-sense lists in sensory.ts, per 1000 words. */
export function sensoryDensity(text: string, paragraphs: ReadonlyArray<Paragraph> = proseParagraphs(text)): SensoryDensity {
  const tokens = proseWords(text, paragraphs);
  const counts = Object.fromEntries(SENSES.map((sense) => [sense, 0])) as Record<Sense, number>;
  let count = 0;
  for (const token of tokens) {
    const sense = senseOf(token.norm);
    if (!sense) continue;
    counts[sense]++;
    count++;
  }
  const per = (n: number) => (tokens.length === 0 ? 0 : (n * 1000) / tokens.length);
  return {
    perThousand: per(count),
    bySense: Object.fromEntries(SENSES.map((sense) => [sense, per(counts[sense])])) as Record<Sense, number>,
    count,
    words: tokens.length,
  };
}

export interface WallOfText extends Span {
  /** Words in the longest run of narration with no dialogue and no paragraph break. */
  readonly words: number;
}

/**
 * The exposition-density proxy: the longest run of words with no dialogue and no
 * paragraph break, a "wall of text". Quoted speech and blank lines both break a
 * run. Null when the chapter has no narration at all.
 */
export function wallOfText(text: string, paragraphs: ReadonlyArray<Paragraph> = proseParagraphs(text), spans = dialogueSpans(text, paragraphs)): WallOfText | null {
  let best: WallOfText | null = null;
  for (const paragraph of paragraphs) {
    const quotes = spans.filter((span) => span.start >= paragraph.start && span.end <= paragraph.end);
    let from = paragraph.start;
    const runs: Span[] = [];
    for (const quote of quotes) {
      runs.push({ start: from, end: quote.start });
      from = quote.end;
    }
    runs.push({ start: from, end: paragraph.end });
    for (const run of runs) {
      const tokens = words(text.slice(run.start, run.end), run.start);
      if (tokens.length === 0) continue;
      if (!best || tokens.length > best.words) best = { start: tokens[0]!.start, end: tokens.at(-1)!.end, words: tokens.length };
    }
  }
  return best;
}

export interface ChapterMetrics {
  readonly words: number;
  readonly paragraphs: Paragraph[];
  readonly sentences: Sentence[];
  /** Null when the chapter has no words. */
  readonly mtld: number | null;
  readonly rhythm: Rhythm | null;
  readonly dialogue: DialogueRatio;
  readonly sensory: SensoryDensity;
  readonly wallOfText: WallOfText | null;
}

/**
 * Every metric for one chapter. English only: a mostly-CJK chapter returns null.
 * Line endings may be LF or CRLF; offsets point into `text` as given.
 */
export function measureChapter(text: string, options: RhythmOptions = {}): ChapterMetrics | null {
  if (isMostlyCjk(text)) return null;
  const paragraphs = proseParagraphs(text);
  const spans = dialogueSpans(text, paragraphs);
  const list = sentences(text, paragraphs, spans);
  const tokens = proseWords(text, paragraphs);
  return {
    words: tokens.length,
    paragraphs,
    sentences: list,
    mtld: mtld(tokens.map((token) => token.norm)),
    rhythm: sentenceRhythm(list, options),
    dialogue: dialogueRatio(text, paragraphs, spans),
    sensory: sensoryDensity(text, paragraphs),
    wallOfText: wallOfText(text, paragraphs, spans),
  };
}
