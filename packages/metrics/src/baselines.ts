import type { Baseline, MetricBands } from "./bands.js";
import { BASELINES } from "./baselines-data.js";

/** Genres with a committed baseline (`baselines/<genre>.json`). */
export const BASELINE_GENRES: ReadonlyArray<string> = Object.keys(BASELINES);

/** The committed baseline for a genre: source books, per-metric percentiles and bands. */
export function baseline(genre: string): Baseline | undefined {
  return BASELINES[genre];
}

/**
 * The bands for a genre, each tagged with where it came from ("general reference
 * books", or "provisional general bands" until a corpus has been measured), for
 * the evidence line. Throws for a genre with no baseline rather than silently
 * falling back.
 */
export function baselineBands(genre: string): MetricBands {
  const found = BASELINES[genre];
  if (!found) throw new Error(`no metric baseline for genre "${genre}"; known: ${BASELINE_GENRES.join(", ")}`);
  const source = found.provisional ? `provisional ${genre} bands` : `${genre} reference books`;
  return Object.fromEntries(Object.entries(found.bands).map(([id, band]) => [id, { source, ...band }]));
}
