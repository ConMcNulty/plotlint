/**
 * Bands for the metric rules. A band is a floor, a ceiling or both, taken from
 * reference books; a rule flags a chapter only outside it ("floors and bands,
 * never targets"). Extra keys tune a rule (e.g. `windowCv` for flat stretches,
 * `minWords` below which a chapter is too short to judge) and `source` names
 * where the band came from, for the evidence line.
 */
export interface MetricBand {
  min?: number;
  max?: number;
  [key: string]: unknown;
}

/** Bands by rule id, the shape of a pack's `metrics:` section. */
export type MetricBands = Record<string, MetricBand>;

/** Percentiles of one metric over the chapters of a genre's reference books. */
export interface MetricStats {
  p5: number;
  p10: number;
  p50: number;
  p90: number;
  p95: number;
  min: number;
  max: number;
}

export interface SourceBook {
  title: string;
  author: string;
  /** Project Gutenberg ebook number. */
  gutenberg?: number;
  /** Year of first publication. */
  year?: number;
  /** Where the measured text came from, e.g. "Standard Ebooks". */
  source?: string;
  /** The text's location at that source. */
  url?: string;
}

/** `packages/metrics/baselines/<genre>.json`, written by `pnpm --filter @plotlint/metrics baselines`. */
export interface Baseline {
  version: 1;
  genre: string;
  /** True for bands set by hand while no reference corpus has been measured. */
  provisional?: boolean;
  note?: string;
  sourceBooks: SourceBook[];
  /** Chapters measured. */
  chapters?: number;
  metrics: Record<string, MetricStats>;
  /** The bands the rules use, set from the stats (about p5 to p95, one-sided where only a floor or ceiling makes sense). */
  bands: MetricBands;
}

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** A band's numeric setting, or `fallback` when it is missing or not a number. */
export function bandNumber(band: MetricBand | undefined, key: string, fallback: number): number;
export function bandNumber(band: MetricBand | undefined, key: string): number | undefined;
export function bandNumber(band: MetricBand | undefined, key: string, fallback?: number): number | undefined {
  return num(band?.[key]) ?? fallback;
}

/** Whether `value` lies outside the band, and on which side. */
export function outside(value: number, band: MetricBand): "below" | "above" | undefined {
  const min = num(band.min);
  const max = num(band.max);
  if (min !== undefined && value < min) return "below";
  if (max !== undefined && value > max) return "above";
  return undefined;
}

/**
 * The band as an evidence phrase: "band 60–120", "floor 60" or "ceiling 350",
 * followed by where it came from.
 */
export function describeBand(band: MetricBand, format: (value: number) => string = String): string {
  const min = num(band.min);
  const max = num(band.max);
  const range = min !== undefined && max !== undefined
    ? `band ${format(min)}–${format(max)}`
    : min !== undefined ? `floor ${format(min)}` : max !== undefined ? `ceiling ${format(max)}` : "no band";
  const source = typeof band.source === "string" && band.source ? ` from ${band.source}` : "";
  return `${range}${source}`;
}

/** Bands with `overrides` laid over `base`, key by key within each rule. */
export function mergeBands(base: MetricBands, overrides: MetricBands | undefined): MetricBands {
  const merged: MetricBands = {};
  for (const id of new Set([...Object.keys(base), ...Object.keys(overrides ?? {})])) {
    merged[id] = { ...base[id], ...overrides?.[id] };
  }
  return merged;
}
