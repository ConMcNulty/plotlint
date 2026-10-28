import { z } from "zod";
import { wilsonInterval } from "@plotlint/diagnostics/verdicts";

// The phase 5 gate asks whether blind readers prefer the loop's output to a single
// pass. A blind pair holds both versions of one chapter as A and B in an order a
// reader cannot guess, with the key kept apart; each reader's preference is
// appended to a log, and `summarizePreferences` reports how often the loop won.

export const PairIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);

export const PairKeySchema = z.object({
  version: z.literal(1),
  id: PairIdSchema,
  chapter: z.number().int().min(0),
  /** Which letter holds the loop's version. */
  loop: z.enum(["A", "B"]),
  createdAt: z.string(),
  /** The loop run's stop reason and scores, for the study report. */
  loopRun: z.record(z.unknown()).optional(),
  singleRun: z.record(z.unknown()).optional(),
}).strict();
export type PairKey = z.infer<typeof PairKeySchema>;

export const PreferenceSchema = z.object({
  pair: PairIdSchema,
  /** The letter the reader preferred, or `same` when they had no preference. */
  choice: z.enum(["A", "B", "same"]),
  reader: z.string().min(1).optional(),
  /** True when the reader was an LLM proxy rather than a person; proxies never count for the gate. */
  proxy: z.boolean().optional(),
  reason: z.string().optional(),
  at: z.string(),
}).strict();
export type Preference = z.infer<typeof PreferenceSchema>;

/** Which letter the loop gets: from a seed, so a test can fix it, else at random. */
export function blindOrder(seed?: string): "A" | "B" {
  if (seed === undefined) return Math.random() < 0.5 ? "A" : "B";
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return (hash >>> 0) % 2 === 0 ? "A" : "B";
}

export interface PreferenceSummary {
  /** Preferences by people with a choice, ties left out. */
  readonly n: number;
  readonly loopWins: number;
  readonly ties: number;
  readonly rate?: number;
  readonly interval?: { readonly low: number; readonly high: number };
  /** The gate's call on the people's preferences: met when the interval's lower end is above one half. */
  readonly call: "loop preferred" | "single pass preferred" | "no clear preference" | "not enough data";
  /** The same counts over LLM-proxy readers, reported apart and never counted for the gate. */
  readonly proxy: { readonly n: number; readonly loopWins: number; readonly ties: number };
}

/** How often blind readers preferred the loop; a reader's later choice on the same pair replaces their earlier one. */
export function summarizePreferences(preferences: ReadonlyArray<Preference>, keys: ReadonlyMap<string, PairKey>, minimum = 20): PreferenceSummary {
  const latest = new Map<string, Preference>();
  for (const preference of preferences) latest.set(`${preference.pair}\u0000${preference.reader ?? ""}\u0000${preference.proxy ? "proxy" : "human"}`, preference);
  const count = (proxy: boolean) => {
    let n = 0, wins = 0, ties = 0;
    for (const preference of latest.values()) {
      const key = keys.get(preference.pair);
      if (!key || Boolean(preference.proxy) !== proxy) continue;
      if (preference.choice === "same") ties += 1;
      else {
        n += 1;
        if (preference.choice === key.loop) wins += 1;
      }
    }
    return { n, loopWins: wins, ties };
  };
  const human = count(false);
  const proxy = count(true);
  if (human.n < minimum) {
    return { ...human, ...(human.n ? { rate: human.loopWins / human.n } : {}), call: "not enough data", proxy };
  }
  const interval = wilsonInterval(human.loopWins, human.n);
  const call = interval.low > 0.5 ? "loop preferred" : interval.high < 0.5 ? "single pass preferred" : "no clear preference";
  return { ...human, rate: human.loopWins / human.n, interval: { low: interval.low, high: interval.high }, call, proxy };
}
