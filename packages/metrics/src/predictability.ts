import type { Diagnostic } from "@plotlint/diagnostics";
import { textDiagnostic, type ChapterTexts, type Rule } from "@plotlint/rules";
import { bandNumber, type MetricBand, type MetricBands } from "./bands.js";
import { metricRuleInfo } from "./rules.js";
import { kneserNeyScorer, type Scorer, type TokenizedChapter } from "./surprisal.js";
import { isMostlyCjk, proseParagraphs, sentences, words, type Span } from "./text.js";

export const PREDICTABILITY_RULE_ID = "metrics/predictability";

/**
 * The default band. The floor is a robust z-score of a stretch's mean surprisal
 * against every stretch in the book (median and MAD), so it is relative to the
 * book: -2.5 means far more predictable than the book usually is. Newton's
 * Opticks (about 100,000 words cut into 20 parts) has one stretch below it, a
 * proposition stated in fixed formulae.
 */
export const DEFAULT_PREDICTABILITY_BAND: Readonly<MetricBand> = {
  min: -2.5,
  window: 5,
  minWindowWords: 40,
  minWords: 300,
  minChapters: 3,
};

/** A run of sentences whose words the scorer found unusually easy to guess. */
export interface PredictableStretch extends Span {
  readonly chapter: number;
  readonly fromSentence: number;
  /** Exclusive. */
  readonly toSentence: number;
  /** Mean surprisal over the stretch's words, bits per word. */
  readonly bitsPerWord: number;
  /** The lowest robust z of a window inside the stretch. */
  readonly z: number;
}

export interface PredictabilityReport {
  readonly stretches: PredictableStretch[];
  /** The book's median window surprisal and its MAD, bits per word. */
  readonly median: number;
  readonly mad: number;
  readonly windows: number;
}

interface ScoredSentence extends Span { readonly bits: number[] }

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Sentences of a chapter's prose with their words, in the scorers' shape. */
function tokenize(text: string): { spans: Span[]; tokens: TokenizedChapter } {
  const found = sentences(text, proseParagraphs(text));
  return {
    spans: found.map(({ start, end }) => ({ start, end })),
    tokens: found.map((sentence) => words(text.slice(sentence.start, sentence.end)).map((word) => word.norm)),
  };
}

/**
 * Stretches of `window` or more sentences, in chapters of at least `minWords`
 * words, whose surprisal per word lies below the band's floor, the floor being
 * a robust z against all windows of the book. Works with any scorer; CJK chapters
 * are skipped and a book of fewer than `minChapters` scored chapters is not judged.
 */
export function findPredictableStretches(chapters: ChapterTexts, scorer: Scorer = kneserNeyScorer(), band: MetricBand = DEFAULT_PREDICTABILITY_BAND): PredictabilityReport {
  const window = Math.max(1, Math.round(bandNumber(band, "window", 5)));
  const minWindowWords = bandNumber(band, "minWindowWords", 40);
  const minWords = bandNumber(band, "minWords", 300);
  const minChapters = bandNumber(band, "minChapters", 3);
  const floor = bandNumber(band, "min", -2.5);
  const empty: PredictabilityReport = { stretches: [], median: 0, mad: 0, windows: 0 };

  const tokenized = new Map<number, { spans: Span[]; tokens: TokenizedChapter }>();
  for (const [chapter, text] of chapters) if (!isMostlyCjk(text)) tokenized.set(chapter, tokenize(text));
  const judged = [...tokenized].filter(([, { tokens }]) => tokens.reduce((sum, sentence) => sum + sentence.length, 0) >= minWords);
  if (judged.length < minChapters) return empty;
  const scores = scorer.score(new Map([...tokenized].map(([chapter, { tokens }]) => [chapter, tokens])));

  // Windows of `window` consecutive sentences, weighted by words.
  const windows: Array<{ chapter: number; from: number; bits: number; words: number }> = [];
  const scored = new Map<number, ScoredSentence[]>();
  for (const [chapter, { spans }] of judged) {
    const bits = scores.get(chapter) ?? [];
    const list = spans.map((span, i) => ({ ...span, bits: bits[i] ?? [] }));
    scored.set(chapter, list);
    for (let from = 0; from + window <= list.length; from++) {
      let sum = 0;
      let count = 0;
      for (const sentence of list.slice(from, from + window)) for (const value of sentence.bits) { sum += value; count++; }
      if (count >= minWindowWords) windows.push({ chapter, from, bits: sum / count, words: count });
    }
  }
  if (windows.length < 2 * window) return { ...empty, windows: windows.length };
  const mid = median(windows.map((w) => w.bits));
  // 1.4826 * MAD estimates a standard deviation; a tiny floor keeps a uniform book from dividing by zero.
  const mad = median(windows.map((w) => Math.abs(w.bits - mid)));
  const scale = Math.max(1.4826 * mad, 1e-6);

  const stretches: PredictableStretch[] = [];
  for (const [chapter, list] of scored) {
    let open: { from: number; to: number; z: number } | undefined;
    const close = () => {
      if (!open) return;
      let sum = 0;
      let count = 0;
      for (const sentence of list.slice(open.from, open.to)) for (const value of sentence.bits) { sum += value; count++; }
      stretches.push({
        chapter, start: list[open.from]!.start, end: list[open.to - 1]!.end,
        fromSentence: open.from, toSentence: open.to, bitsPerWord: sum / count, z: open.z,
      });
      open = undefined;
    };
    for (const w of windows) {
      if (w.chapter !== chapter) continue;
      const z = (w.bits - mid) / scale;
      if (z >= floor) continue;
      // Overlapping or touching low windows merge into one stretch.
      if (open && w.from <= open.to) {
        open.to = Math.max(open.to, w.from + window);
        open.z = Math.min(open.z, z);
      } else {
        close();
        open = { from: w.from, to: w.from + window, z };
      }
    }
    close();
  }
  return { stretches, median: mid, mad, windows: windows.length };
}

export interface PredictabilityOptions {
  /** The model behind the surprisal; the book-relative Kneser-Ney trigram model by default. */
  readonly scorer?: Scorer;
  /** Bands by rule id (a pack's `metrics:` section); `metrics/predictability` is read. */
  readonly bands?: MetricBands;
}

const numbers = (options: Readonly<Record<string, unknown>>): MetricBand =>
  Object.fromEntries(Object.entries(options).filter(([, value]) => typeof value === "number" && Number.isFinite(value)));

const fixed = (value: number, digits = 1) => value.toFixed(digits);

/**
 * `metrics/predictability`: a book-level state rule over `context.chapters`. Each
 * stretch of unusually predictable prose gets a ranged note. The band is the
 * default, then the pack's `metrics/predictability` band, then numeric options
 * from the book's rule config. Results are cached for the last book text seen.
 */
export function predictabilityRule(defaults: PredictabilityOptions = {}): Rule {
  const info = metricRuleInfo[PREDICTABILITY_RULE_ID];
  const scorer = defaults.scorer ?? kneserNeyScorer();
  let cache: { key: string; report: PredictabilityReport } | undefined;
  const rule: Rule = {
    ...info,
    layer: "metrics",
    check(context): Diagnostic[] {
      if (!context.chapters) return [];
      const band: MetricBand = { ...DEFAULT_PREDICTABILITY_BAND, ...defaults.bands?.[PREDICTABILITY_RULE_ID], ...numbers(context.options ?? {}) };
      const key = JSON.stringify(band) + [...context.chapters].map(([chapter, text]) => `\u0000${chapter}\u0000${text}`).join("");
      const report = cache?.key === key ? cache.report : findPredictableStretches(context.chapters, scorer, band);
      cache = { key, report };
      const source = typeof band.source === "string" && band.source ? ` from ${band.source}` : "";
      return report.stretches.map((stretch) => {
        const text = context.chapters!.get(stretch.chapter)!;
        const count = stretch.toSentence - stretch.fromSentence;
        return textDiagnostic({
          rule,
          document: { sourceId: `chapter:${stretch.chapter}`, chapter: stretch.chapter, text },
          start: stretch.start,
          end: stretch.end,
          severity: "note",
          summary: `${count} sentences far more predictable than the rest of the book`,
          evidence: [
            `Surprisal ${fixed(stretch.bitsPerWord)} bits per word; the book's median is ${fixed(report.median)} (robust z ${fixed(stretch.z)}, floor ${fixed(bandNumber(band, "min", -2.5))}${source})`,
            `Measured with a ${scorer.name} against ${scorer.reference}`,
          ],
        });
      });
    },
  };
  return rule;
}
