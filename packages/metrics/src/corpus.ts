import { bandNumber, type Baseline, type MetricBands, type MetricStats, type SourceBook } from "./bands.js";
import { measureChapter, type ChapterMetrics } from "./measures.js";

/**
 * Reading reference novels for the baselines: strip Project Gutenberg's
 * boilerplate, split chapters, and turn per-chapter measurements into bands.
 */

/** The book's own text between Gutenberg's `*** START OF ...` and `*** END OF ...` markers, LF line endings. */
export function stripGutenberg(raw: string): string {
  const text = raw.replace(/\r\n?/gu, "\n");
  const start = text.match(/^\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG.*$/imu);
  const end = text.match(/^\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG.*$/imu);
  const from = start ? start.index! + start[0].length : 0;
  const to = end && end.index! > from ? end.index! : text.length;
  return text.slice(from, to).trim();
}

/** Title and author from a Gutenberg header, when present. */
export function gutenbergHeader(raw: string): Partial<SourceBook> {
  const title = raw.match(/^Title:\s*(.+)$/mu)?.[1]?.trim();
  const author = raw.match(/^Author:\s*(.+)$/mu)?.[1]?.trim();
  const number = raw.match(/\[(?:E(?:Book|text)) #(\d+)\]/iu)?.[1];
  return { ...(title ? { title } : {}), ...(author ? { author } : {}), ...(number ? { gutenberg: Number(number) } : {}) };
}

const HEADING = /^[ \t]*(?:(?:CHAPTER|Chapter|LETTER|Letter|STAVE|Stave)[ \t]+(?:[IVXLCDM]+|\d+|[A-Z][A-Za-z-]+)\b[^\n]*|[IVXLC]+\.?)[ \t]*$/gmu;

/**
 * Chapters of a stripped book: the text between chapter headings ("CHAPTER I.",
 * "Chapter 12", "LETTER IV", or a roman numeral alone on a line). Pieces shorter
 * than `minWords` (tables of contents, front matter, epigraphs) are dropped.
 */
export function splitChapters(book: string, minWords = 500): string[] {
  const headings = [...book.matchAll(HEADING)];
  const pieces = headings.length === 0
    ? [book]
    : headings.map((match, i) => book.slice(match.index! + match[0].length, headings[i + 1]?.index ?? book.length));
  return pieces
    .map((piece) => piece.trim())
    .filter((piece) => (piece.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= minWords);
}

/** Linear-interpolated percentiles of the values (at least one). */
export function percentiles(values: ReadonlyArray<number>): MetricStats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    const index = (sorted.length - 1) * p;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    return sorted[low]! + (sorted[high]! - sorted[low]!) * (index - low);
  };
  const r = (value: number) => Math.round(value * 10000) / 10000;
  return {
    p5: r(at(0.05)), p10: r(at(0.1)), p50: r(at(0.5)), p90: r(at(0.9)), p95: r(at(0.95)), min: r(sorted[0]!), max: r(sorted.at(-1)!),
  };
}

/** The value each band is set from, per measured chapter. */
export const BASELINE_VALUES: Record<string, (metrics: ChapterMetrics) => number | null | undefined> = {
  "metrics/lexical-diversity": (metrics) => metrics.mtld,
  "metrics/sentence-rhythm": (metrics) => metrics.rhythm?.cv,
  "metrics/sentence-rhythm#window": (metrics) => metrics.rhythm?.flattestWindowCv,
  "metrics/dialogue-ratio": (metrics) => metrics.dialogue.ratio,
  "metrics/sensory-detail": (metrics) => metrics.sensory.perThousand,
  "metrics/wall-of-text": (metrics) => metrics.wallOfText?.words,
};

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Bands from the stats, about p5 to p95: floors for lexical diversity, rhythm and
 * sensory detail (more is never a fault), a ceiling for walls of text, and both
 * ends for dialogue, dropping a floor that would sit at zero.
 */
export function bandsFromStats(stats: Record<string, MetricStats>, previous: MetricBands = {}): MetricBands {
  const keep = (id: string, keys: string[]) =>
    Object.fromEntries(keys.flatMap((key) => (previous[id]?.[key] === undefined ? [] : [[key, previous[id]![key]]])));
  const bands: MetricBands = {};
  const s = (id: string) => stats[id];
  if (s("metrics/lexical-diversity")) bands["metrics/lexical-diversity"] = { ...keep("metrics/lexical-diversity", ["minWords"]), min: round(s("metrics/lexical-diversity")!.p5, 0) };
  if (s("metrics/sentence-rhythm")) {
    bands["metrics/sentence-rhythm"] = {
      ...keep("metrics/sentence-rhythm", ["minWords", "minSentences", "window"]),
      min: round(s("metrics/sentence-rhythm")!.p5, 2),
      windowCv: round(Math.min(s("metrics/sentence-rhythm#window")?.p5 ?? 0.2, 0.25), 2),
    };
  }
  if (s("metrics/dialogue-ratio")) {
    const { p5, p95 } = s("metrics/dialogue-ratio")!;
    bands["metrics/dialogue-ratio"] = { ...keep("metrics/dialogue-ratio", ["minWords"]), ...(p5 >= 0.01 ? { min: round(p5, 2) } : {}), max: round(p95, 2) };
  }
  if (s("metrics/sensory-detail")) bands["metrics/sensory-detail"] = { ...keep("metrics/sensory-detail", ["minWords"]), min: round(s("metrics/sensory-detail")!.p5, 1) };
  if (s("metrics/wall-of-text")) bands["metrics/wall-of-text"] = { max: Math.round(s("metrics/wall-of-text")!.p95) };
  return bands;
}

/** A baseline for one genre from the books' chapter texts. */
export function buildBaseline(genre: string, books: ReadonlyArray<{ book: SourceBook; chapters: ReadonlyArray<string> }>, previous?: MetricBands): Baseline {
  const values: Record<string, number[]> = Object.fromEntries(Object.keys(BASELINE_VALUES).map((id) => [id, []]));
  let chapters = 0;
  for (const { chapters: texts } of books) {
    for (const text of texts) {
      const metrics = measureChapter(text, {
        window: bandNumber(previous?.["metrics/sentence-rhythm"], "window", 8),
      });
      if (!metrics) continue;
      chapters++;
      for (const [id, read] of Object.entries(BASELINE_VALUES)) {
        const value = read(metrics);
        if (typeof value === "number" && Number.isFinite(value)) values[id]!.push(value);
      }
    }
  }
  const stats = Object.fromEntries(Object.entries(values).filter(([, list]) => list.length > 0).map(([id, list]) => [id, percentiles(list)]));
  return { version: 1, genre, sourceBooks: books.map(({ book }) => book), chapters, metrics: stats, bands: bandsFromStats(stats, previous) };
}
