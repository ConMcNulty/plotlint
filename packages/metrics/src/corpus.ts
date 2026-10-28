import { bandNumber, type Baseline, type MetricBands, type MetricStats, type SourceBook } from "./bands.js";
import { measureChapter, type ChapterMetrics } from "./measures.js";

/**
 * Reading reference novels for the baselines: chapters from Standard Ebooks'
 * XHTML sources or Project Gutenberg plain text (boilerplate stripped), and
 * per-chapter measurements turned into bands.
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

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/**
 * Plain text of an XHTML fragment: paragraphs and block elements become blocks
 * separated by blank lines, `<hr/>` a `* * *` scene break, `<br/>` a line break.
 * Headings, footnote references and markup are dropped, entities decoded, and
 * the word joiners and soft hyphens of typeset ebooks removed.
 */
export function xhtmlToText(fragment: string): string {
  return fragment
    // Source line breaks and indentation are not text in XHTML; only the markup breaks lines.
    .replace(/\s+/gu, " ")
    .replace(/<(header|hgroup|h[1-6])\b[^>]*>[\s\S]*?<\/\1>/gu, "\n\n")
    .replace(/<a\b[^>]*epub:type="[^"]*noteref[^"]*"[^>]*>[\s\S]*?<\/a>/gu, "")
    .replace(/<hr\b[^>]*\/?>/gu, "\n\n* * *\n\n")
    .replace(/<br\b[^>]*\/?>/gu, "\n")
    .replace(/<\/?(?:p|div|blockquote|section|article|table|tr|li|ul|ol|footer|figure|aside)\b[^>]*>/gu, "\n\n")
    .replace(/<[^>]*>/gu, "")
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/giu, (whole, dec: string, hex: string, name: string) =>
      dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/[⁠­﻿]/gu, "")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/**
 * Chapters of one Standard Ebooks XHTML file (`src/epub/text/*.xhtml` in their
 * source repositories): the text of each `<section epub:type="chapter">` that
 * holds no chapter section of its own, or of the whole body when the file is
 * body matter without chapter sections. Front and back matter (title page,
 * imprint, colophon, endnotes) yields nothing.
 */
export function standardEbooksChapters(xhtml: string): string[] {
  const body = xhtml.match(/<body\b([^>]*)>([\s\S]*)<\/body>/u);
  if (!body || !/epub:type="[^"]*\bbodymatter\b/u.test(body[1]!)) return [];
  const inner = body[2]!;
  const stack: Array<{ start: number; chapter: boolean; nested: boolean }> = [];
  const chapters: string[] = [];
  for (const tag of inner.matchAll(/<(\/?)section\b([^>]*)>/gu)) {
    if (!tag[1]) {
      stack.push({ start: tag.index! + tag[0].length, chapter: /epub:type="[^"]*\bchapter\b/u.test(tag[2]!), nested: false });
      continue;
    }
    const open = stack.pop();
    if (!open?.chapter) continue;
    if (!open.nested) chapters.push(xhtmlToText(inner.slice(open.start, tag.index)));
    for (const outer of stack) outer.nested = true;
  }
  if (chapters.length > 0) return chapters;
  const whole = xhtmlToText(inner);
  return whole ? [whole] : [];
}

/** The XHTML files of a Standard Ebooks `content.opf`, in reading (spine) order, as paths under `src/epub/`. */
export function standardEbooksSpine(opf: string): string[] {
  const hrefs = new Map<string, string>();
  for (const item of opf.matchAll(/<item\b[^>]*>/gu)) {
    const id = item[0].match(/\bid="([^"]+)"/u)?.[1];
    const href = item[0].match(/\bhref="([^"]+)"/u)?.[1];
    if (id && href) hrefs.set(id, href);
  }
  return [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/gu)].flatMap((ref) => {
    const href = hrefs.get(ref[1]!);
    return href && /\.xhtml$/u.test(href) ? [href] : [];
  });
}

/**
 * Linear-interpolated percentiles of the values (at least one). With `weights`,
 * each value counts by its weight: the values sit at the midpoints of their
 * cumulative weight, so equal weights give the plain unweighted percentiles.
 */
export function percentiles(values: ReadonlyArray<number>, weights?: ReadonlyArray<number>): MetricStats {
  const points = values.map((value, i) => ({ value, weight: weights?.[i] ?? 1 })).sort((a, b) => a.value - b.value);
  const first = points[0]!.weight / 2;
  const span = points.reduce((sum, point) => sum + point.weight, 0) - first - points.at(-1)!.weight / 2;
  const positions: number[] = [];
  let before = 0;
  for (const point of points) {
    positions.push(span > 0 ? (before + point.weight / 2 - first) / span : 0);
    before += point.weight;
  }
  const at = (p: number) => {
    const high = positions.findIndex((position) => position >= p);
    if (high <= 0) return points[Math.max(high, 0)]!.value;
    const low = high - 1;
    const t = (p - positions[low]!) / (positions[high]! - positions[low]!);
    return points[low]!.value + (points[high]!.value - points[low]!.value) * t;
  };
  const r = (value: number) => Math.round(value * 10000) / 10000;
  return {
    p5: r(at(0.05)), p10: r(at(0.1)), p50: r(at(0.5)), p90: r(at(0.9)), p95: r(at(0.95)), min: r(points[0]!.value), max: r(points.at(-1)!.value),
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

/**
 * A baseline for one genre from the books' chapter texts. Every book weighs the
 * same, whatever its number of chapters, so one long book with short chapters
 * does not set the genre's bands alone.
 */
export function buildBaseline(genre: string, books: ReadonlyArray<{ book: SourceBook; chapters: ReadonlyArray<string> }>, previous?: MetricBands): Baseline {
  const values: Record<string, Array<{ value: number; weight: number }>> = Object.fromEntries(Object.keys(BASELINE_VALUES).map((id) => [id, []]));
  let chapters = 0;
  for (const { chapters: texts } of books) {
    const measured = texts.flatMap((text) => {
      const metrics = measureChapter(text, { window: bandNumber(previous?.["metrics/sentence-rhythm"], "window", 8) });
      return metrics ? [metrics] : [];
    });
    chapters += measured.length;
    for (const metrics of measured) {
      for (const [id, read] of Object.entries(BASELINE_VALUES)) {
        const value = read(metrics);
        if (typeof value === "number" && Number.isFinite(value)) values[id]!.push({ value, weight: 1 / measured.length });
      }
    }
  }
  const stats = Object.fromEntries(Object.entries(values).filter(([, list]) => list.length > 0)
    .map(([id, list]) => [id, percentiles(list.map((point) => point.value), list.map((point) => point.weight))]));
  return { version: 1, genre, sourceBooks: books.map(({ book }) => book), chapters, metrics: stats, bands: bandsFromStats(stats, previous) };
}
