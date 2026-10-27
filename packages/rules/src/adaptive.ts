import { latestVerdicts, verdictStats, type Verdict } from "@plotlint/diagnostics/verdicts";
import type { RuleConfigFile } from "./book.js";

/**
 * Human verdicts close the loop: a check the author keeps rejecting in one book
 * is lowered for that book, in two steps.
 *
 * 1. Once a rule has `minVerdicts` standing verdicts (the latest per finding) and
 *    more than `rejectAbove` of them reject it, its findings become notes.
 * 2. Once it has `offAfter` standing verdicts, more than `rejectAbove` of them
 *    still reject it, and so do more than `rejectAbove` of its most recent
 *    `minVerdicts` (the author kept rejecting it after it became a note), it is
 *    turned off for the book.
 *
 * It never raises a severity, and it lifts on its own: when the author starts
 * accepting the findings again and the rejection rate drops to the threshold
 * or below, the rule drops out of the overlay. A rule that is off stops
 * producing findings and so stays off until the author turns it back on. The
 * overlay goes between the pack defaults and the book's own `rules.json`, so an
 * explicit setting there wins (`"continuity/dead-then-alive": "warning"` undoes it).
 */
export interface AdaptiveOptions {
  /** Standing verdicts a rule needs before it is lowered at all. */
  readonly minVerdicts?: number;
  /** Lowered when more than this share of the standing verdicts reject it. */
  readonly rejectAbove?: number;
  /** Standing verdicts before a lowered rule can be turned off; three times `minVerdicts` by default. */
  readonly offAfter?: number;
}

export interface AdaptiveDecision {
  readonly ruleId: string;
  readonly setting: "note" | "off";
  readonly n: number;
  readonly rejectRate: number;
  /** Rejection rate over the most recent `minVerdicts` standing verdicts. */
  readonly recentRejectRate: number;
}

/** Which rules the author's verdicts lower in this book, and why. */
export function adaptiveDecisions(verdicts: ReadonlyArray<Verdict>, options: AdaptiveOptions = {}): AdaptiveDecision[] {
  const minVerdicts = Math.max(1, options.minVerdicts ?? 5);
  const rejectAbove = options.rejectAbove ?? 0.5;
  const offAfter = Math.max(minVerdicts, options.offAfter ?? minVerdicts * 3);

  // Most recent first, per rule, to judge whether rejection has stayed high.
  const standing = latestVerdicts(verdicts);
  const recentByRule = new Map<string, Verdict[]>();
  for (const verdict of [...standing].reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const list = recentByRule.get(verdict.ruleId) ?? [];
    if (list.length < minVerdicts) list.push(verdict);
    recentByRule.set(verdict.ruleId, list);
  }

  const decisions: AdaptiveDecision[] = [];
  for (const row of verdictStats(standing)) {
    if (row.n < minVerdicts || row.rejectRate <= rejectAbove) continue;
    const recent = recentByRule.get(row.ruleId) ?? [];
    const recentRejectRate = recent.filter((verdict) => verdict.verdict === "rejected").length / Math.max(1, recent.length);
    const off = row.n >= offAfter && recentRejectRate > rejectAbove;
    decisions.push({ ruleId: row.ruleId, setting: off ? "off" : "note", n: row.n, rejectRate: row.rejectRate, recentRejectRate });
  }
  return decisions;
}

/**
 * The book's verdicts as a `rules.json`-shaped overlay (see `adaptiveDecisions`
 * for the policy). Apply it after the pack defaults and before the book's own
 * `rules.json`, so the author's explicit settings win over what was inferred.
 */
export function adaptiveOverlay(verdicts: ReadonlyArray<Verdict>, options: AdaptiveOptions = {}): RuleConfigFile {
  return {
    version: 1,
    rules: Object.fromEntries(adaptiveDecisions(verdicts, options).map((decision) => [decision.ruleId, decision.setting])),
  };
}
