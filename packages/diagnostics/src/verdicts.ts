import { z } from "zod";
import {
  DiagnosticConfidenceSchema,
  DiagnosticLayerSchema,
  diagnosticFingerprint,
  type Diagnostic,
  type DiagnosticLayer,
} from "./index.js";

/**
 * Human verdicts on findings, for the writer study and for lowering checks an
 * author keeps rejecting. A verdict says whether the writer took a finding
 * (`accepted`: applied its fix or edited the flagged text) or turned it down
 * (`rejected`: marked it intentional, dismissed it or called it not useful).
 * They are appended to `works/<id>/source/story/plotlint/verdicts.jsonl`, one
 * JSON object per line; `@plotlint/diagnostics/node` reads and writes the file.
 */

export const VerdictKindSchema = z.enum(["accepted", "rejected"]);
export type VerdictKind = z.infer<typeof VerdictKindSchema>;

/**
 * What the writer did: `fix` applied a quick fix, `edited` changed the flagged
 * text until the finding went away, `intentional` marked it as intentional,
 * `dismissed` turned it down without saying why (the CLI default), and
 * `not-useful` said the finding was not worth showing.
 */
export const VerdictActionSchema = z.enum(["fix", "edited", "intentional", "dismissed", "not-useful"]);
export type VerdictAction = z.infer<typeof VerdictActionSchema>;

const ACCEPTING: ReadonlySet<VerdictAction> = new Set(["fix", "edited"]);

/** The verdict an action implies: fixing or editing accepts, everything else rejects. */
export const verdictOfAction = (action: VerdictAction): VerdictKind => ACCEPTING.has(action) ? "accepted" : "rejected";

export const VerdictSchema = z.object({
  ruleId: z.string().min(1),
  /** `diagnosticFingerprint` of the finding, so a later verdict on the same finding replaces this one. */
  fingerprint: z.string().min(1),
  chapter: z.number().int().min(0).optional(),
  verdict: VerdictKindSchema,
  action: VerdictActionSchema,
  /** ISO 8601 time the writer decided. */
  at: z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value)), { message: "at must be an ISO date" }),
  author: z.string().min(1).optional(),
  /** The flagged text or summary, so a human reading the file can tell what it was about. */
  quote: z.string().optional(),
  layer: DiagnosticLayerSchema,
  confidence: DiagnosticConfidenceSchema,
}).strict().refine((verdict) => verdictOfAction(verdict.action) === verdict.verdict, {
  message: "action does not match verdict (fix and edited accept; intentional, dismissed and not-useful reject)",
});
export type Verdict = z.infer<typeof VerdictSchema>;

/** Build a verdict on one finding; the fingerprint is computed unless the finding carries one. */
export function verdictOn(
  diagnostic: Diagnostic & { readonly fingerprint?: string },
  action: VerdictAction,
  extra: { readonly at?: string; readonly author?: string } = {},
): Verdict {
  const { fingerprint, ...finding } = diagnostic;
  const quote = finding.sourceRefs?.[0]?.quote ?? finding.summary;
  return VerdictSchema.parse({
    ruleId: finding.ruleId,
    fingerprint: fingerprint ?? diagnosticFingerprint(finding as Diagnostic),
    ...(finding.chapter === undefined ? {} : { chapter: finding.chapter }),
    verdict: verdictOfAction(action),
    action,
    at: extra.at ?? new Date().toISOString(),
    ...(extra.author?.trim() ? { author: extra.author.trim() } : {}),
    ...(quote ? { quote: quote.slice(0, 500) } : {}),
    layer: finding.layer,
    confidence: finding.confidence,
  });
}

/** One line of `verdicts.jsonl`, newline included. */
export const formatVerdictLine = (verdict: Verdict): string => `${JSON.stringify(VerdictSchema.parse(verdict))}\n`;

export interface ParsedVerdicts {
  readonly verdicts: Verdict[];
  /** 1-based line numbers that were not a valid verdict (a torn write, a hand edit); they are skipped. */
  readonly skipped: number[];
}

/** Read JSON lines tolerantly: blank lines are ignored, bad lines skipped and reported, CRLF and a BOM accepted. */
export function parseVerdictLines(text: string): ParsedVerdicts {
  const verdicts: Verdict[] = [];
  const skipped: number[] = [];
  text.replace(/^﻿/u, "").split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      skipped.push(index + 1);
      return;
    }
    const parsed = VerdictSchema.safeParse(json);
    if (parsed.success) verdicts.push(parsed.data);
    else skipped.push(index + 1);
  });
  return { verdicts, skipped };
}

/**
 * The verdict that stands for each finding: the latest per rule and fingerprint,
 * so a writer who changes their mind counts once, as they last decided. Ties on
 * time go to the later line. Returned in file order of the winning verdicts.
 */
export function latestVerdicts(verdicts: ReadonlyArray<Verdict>): Verdict[] {
  const latest = new Map<string, { verdict: Verdict; index: number; time: number }>();
  verdicts.forEach((verdict, index) => {
    const key = `${verdict.ruleId}\u0000${verdict.fingerprint}`;
    const time = Date.parse(verdict.at);
    const current = latest.get(key);
    if (!current || time >= current.time) latest.set(key, { verdict, index, time });
  });
  return [...latest.values()].sort((a, b) => a.index - b.index).map((entry) => entry.verdict);
}

export interface Interval {
  readonly low: number;
  readonly high: number;
}

/**
 * The Wilson score interval for `successes` out of `n` (95% by default). Unlike
 * the plain ratio +/- error it stays inside [0, 1] and behaves for small samples,
 * which is what a writer study has per check. `n` of 0 gives [0, 1].
 */
export function wilsonInterval(successes: number, n: number, z = 1.959964): Interval {
  if (n <= 0) return { low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface RuleVerdictStats {
  readonly ruleId: string;
  /** The layer of the latest verdict on the rule. */
  readonly layer: DiagnosticLayer;
  readonly accepted: number;
  readonly rejected: number;
  readonly n: number;
  /** accepted / n, 0 when n is 0. */
  readonly acceptRate: number;
  /** rejected / n, 0 when n is 0. */
  readonly rejectRate: number;
  /** 95% Wilson interval of the rejection rate. */
  readonly rejectInterval: Interval;
  readonly byAction: Readonly<Record<VerdictAction, number>>;
}

const emptyActions = (): Record<VerdictAction, number> =>
  Object.fromEntries(VerdictActionSchema.options.map((action) => [action, 0])) as Record<VerdictAction, number>;

function statsOf(ruleId: string, layer: DiagnosticLayer, accepted: number, rejected: number, byAction: Record<VerdictAction, number>): RuleVerdictStats {
  const n = accepted + rejected;
  return {
    ruleId,
    layer,
    accepted,
    rejected,
    n,
    acceptRate: n === 0 ? 0 : accepted / n,
    rejectRate: n === 0 ? 0 : rejected / n,
    rejectInterval: wilsonInterval(rejected, n),
    byAction,
  };
}

/** Accept and reject counts per rule over the standing verdicts (latest per finding), sorted by rule id. */
export function verdictStats(verdicts: ReadonlyArray<Verdict>): RuleVerdictStats[] {
  const byRule = new Map<string, { layer: DiagnosticLayer; accepted: number; rejected: number; byAction: Record<VerdictAction, number> }>();
  for (const verdict of latestVerdicts(verdicts)) {
    const entry = byRule.get(verdict.ruleId) ?? { layer: verdict.layer, accepted: 0, rejected: 0, byAction: emptyActions() };
    entry.layer = verdict.layer;
    if (verdict.verdict === "accepted") entry.accepted++;
    else entry.rejected++;
    entry.byAction[verdict.action]++;
    byRule.set(verdict.ruleId, entry);
  }
  return [...byRule].sort(([a], [b]) => a.localeCompare(b))
    .map(([ruleId, entry]) => statsOf(ruleId, entry.layer, entry.accepted, entry.rejected, entry.byAction));
}

/** Pool per-book stats into one row per rule, summing counts (each book's verdicts are already latest per finding). */
export function poolStats(statsAcrossBooks: ReadonlyArray<ReadonlyArray<RuleVerdictStats>>): Array<RuleVerdictStats & { readonly books: number }> {
  const pooled = new Map<string, { layer: DiagnosticLayer; accepted: number; rejected: number; books: number; byAction: Record<VerdictAction, number> }>();
  for (const book of statsAcrossBooks) {
    for (const row of book) {
      const entry = pooled.get(row.ruleId) ?? { layer: row.layer, accepted: 0, rejected: 0, books: 0, byAction: emptyActions() };
      entry.accepted += row.accepted;
      entry.rejected += row.rejected;
      if (row.n > 0) entry.books++;
      for (const action of VerdictActionSchema.options) entry.byAction[action] += row.byAction[action];
      pooled.set(row.ruleId, entry);
    }
  }
  return [...pooled].sort(([a], [b]) => a.localeCompare(b))
    .map(([ruleId, entry]) => ({ ...statsOf(ruleId, entry.layer, entry.accepted, entry.rejected, entry.byAction), books: entry.books }));
}

/** The phase 4 gate per check: `stays-on`, `off-by-default` (rejected more often than allowed) or `not-enough-data`. */
export type StudyOutcome = "stays-on" | "off-by-default" | "not-enough-data";

export interface StudyDecision extends RuleVerdictStats {
  readonly books: number;
  readonly outcome: StudyOutcome;
  /** The 95% interval lies wholly on the outcome's side of the threshold, so more data is unlikely to flip it. */
  readonly settled: boolean;
}

export interface StudyOptions {
  /** A check rejected more than this share of the time goes off by default. The gate is 0.5. */
  readonly rejectAbove?: number;
  /** Fewer standing verdicts than this, pooled over all books, is not enough to decide. */
  readonly minVerdicts?: number;
}

export const STUDY_REJECT_ABOVE = 0.5;
export const STUDY_MIN_VERDICTS = 20;

/** Apply the gate to every check with verdicts, pooling the books first (see docs/plotlint/WRITER-STUDY.md). */
export function studyReport(statsAcrossBooks: ReadonlyArray<ReadonlyArray<RuleVerdictStats>>, options: StudyOptions = {}): StudyDecision[] {
  const rejectAbove = options.rejectAbove ?? STUDY_REJECT_ABOVE;
  const minVerdicts = options.minVerdicts ?? STUDY_MIN_VERDICTS;
  return poolStats(statsAcrossBooks).map((row) => {
    const outcome: StudyOutcome = row.n < minVerdicts ? "not-enough-data" : row.rejectRate > rejectAbove ? "off-by-default" : "stays-on";
    const settled = outcome === "off-by-default" ? row.rejectInterval.low > rejectAbove
      : outcome === "stays-on" ? row.rejectInterval.high <= rejectAbove
        : false;
    return { ...row, outcome, settled };
  });
}

/** The checks the gate turns off by default: rejected more than `rejectAbove` of the time over at least `minVerdicts` verdicts. */
export function studyDefaults(statsAcrossBooks: ReadonlyArray<ReadonlyArray<RuleVerdictStats>>, options: StudyOptions = {}): string[] {
  return studyReport(statsAcrossBooks, options).filter((row) => row.outcome === "off-by-default").map((row) => row.ruleId);
}
