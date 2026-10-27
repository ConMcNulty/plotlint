import { describe, expect, it } from "vitest";
import { diagnosticFingerprint, type Diagnostic } from "../index.js";
import {
  formatVerdictLine,
  latestVerdicts,
  parseVerdictLines,
  poolStats,
  studyDefaults,
  studyReport,
  verdictOfAction,
  verdictOn,
  VerdictSchema,
  verdictStats,
  wilsonInterval,
  type Verdict,
  type VerdictAction,
} from "../verdicts.js";

const finding: Diagnostic = {
  code: "spelling",
  ruleId: "mechanics/harper",
  layer: "mechanics",
  severity: "warning",
  confidence: "deterministic",
  summary: "Did you mean \"the\"?",
  evidence: ["\"teh\""],
  chapter: 3,
};

let clock = 0;
const verdict = (ruleId: string, fingerprint: string, action: VerdictAction, at?: string): Verdict => ({
  ruleId,
  fingerprint,
  verdict: verdictOfAction(action),
  action,
  at: at ?? new Date(Date.UTC(2026, 9, 27, 0, 0, clock++)).toISOString(),
  layer: "style",
  confidence: "deterministic",
});

describe("VerdictSchema", () => {
  it("builds a verdict from a finding, with its fingerprint and quote", () => {
    const built = verdictOn(finding, "fix", { at: "2026-10-27T00:00:00.000Z", author: " cob " });
    expect(built).toEqual({
      ruleId: "mechanics/harper",
      fingerprint: diagnosticFingerprint(finding),
      chapter: 3,
      verdict: "accepted",
      action: "fix",
      at: "2026-10-27T00:00:00.000Z",
      author: "cob",
      quote: "Did you mean \"the\"?",
      layer: "mechanics",
      confidence: "deterministic",
    });
    expect(verdictOn({ ...finding, fingerprint: "given" }, "not-useful").fingerprint).toBe("given");
  });

  it("refuses an action that contradicts the verdict, and bad fields", () => {
    const good = verdict("style/x", "a", "intentional");
    expect(VerdictSchema.safeParse(good).success).toBe(true);
    expect(VerdictSchema.safeParse({ ...good, verdict: "accepted" }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...good, action: "ignored" }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...good, at: "yesterday" }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...good, layer: "vibes" }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(["fix", "edited"].map((a) => verdictOfAction(a as VerdictAction))).toEqual(["accepted", "accepted"]);
    expect(["intentional", "dismissed", "not-useful"].map((a) => verdictOfAction(a as VerdictAction))).toEqual(["rejected", "rejected", "rejected"]);
  });
});

describe("parseVerdictLines", () => {
  it("skips blank and bad lines, reporting their line numbers, and reads CRLF and a BOM", () => {
    const a = verdict("style/x", "a", "fix");
    const b = verdict("style/x", "b", "dismissed");
    const text = `﻿${formatVerdictLine(a).trimEnd()}\r\n\r\n{"ruleId":\r\nnot json\r\n${JSON.stringify({ ...b, verdict: "accepted" })}\r\n${formatVerdictLine(b)}`;
    expect(parseVerdictLines(text)).toEqual({ verdicts: [a, b], skipped: [3, 4, 5] });
    expect(parseVerdictLines("")).toEqual({ verdicts: [], skipped: [] });
  });
});

describe("latestVerdicts and verdictStats", () => {
  it("counts each finding once, as the writer last decided", () => {
    const verdicts = [
      verdict("style/x", "a", "intentional"),
      verdict("style/x", "b", "fix"),
      verdict("style/x", "a", "edited"), // changed their mind
      verdict("style/y", "a", "not-useful"), // same fingerprint, other rule
    ];
    expect(latestVerdicts(verdicts)).toEqual([verdicts[1], verdicts[2], verdicts[3]]);
    const [x, y] = verdictStats(verdicts);
    expect(x).toMatchObject({ ruleId: "style/x", accepted: 2, rejected: 0, n: 2, acceptRate: 1, rejectRate: 0 });
    expect(x!.byAction).toMatchObject({ fix: 1, edited: 1, intentional: 0 });
    expect(y).toMatchObject({ ruleId: "style/y", accepted: 0, rejected: 1, n: 1, rejectRate: 1 });
  });

  it("orders by time, not file position, and breaks ties by the later line", () => {
    const late = verdict("style/x", "a", "fix", "2026-10-28T00:00:00.000Z");
    const early = verdict("style/x", "a", "dismissed", "2026-10-27T00:00:00.000Z");
    expect(latestVerdicts([late, early])).toEqual([late]);
    const tie = verdict("style/x", "a", "dismissed", late.at);
    expect(latestVerdicts([late, tie])).toEqual([tie]);
  });
});

describe("wilsonInterval", () => {
  it("matches the textbook values and stays inside [0, 1]", () => {
    const half = wilsonInterval(5, 10);
    expect(half.low).toBeCloseTo(0.2366, 3);
    expect(half.high).toBeCloseTo(0.7634, 3);
    const none = wilsonInterval(0, 10);
    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.2775, 3);
    const all = wilsonInterval(20, 20);
    expect(all.high).toBe(1);
    expect(all.low).toBeCloseTo(0.8389, 3);
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe("the study gate", () => {
  const book = (ruleId: string, accepted: number, rejected: number): Verdict[] => [
    ...Array.from({ length: accepted }, (_, i) => verdict(ruleId, `${ruleId}-acc-${i}`, "fix")),
    ...Array.from({ length: rejected }, (_, i) => verdict(ruleId, `${ruleId}-rej-${i}`, "intentional")),
  ];

  it("pools books and turns off checks rejected more than half the time", () => {
    const one = verdictStats([...book("style/cliche", 4, 8), ...book("style/filter", 9, 3), ...book("style/rare", 1, 2)]);
    const two = verdictStats([...book("style/cliche", 2, 7), ...book("style/filter", 6, 4), ...book("style/even", 10, 10)]);
    const pooled = poolStats([one, two]);
    expect(pooled.find((row) => row.ruleId === "style/cliche")).toMatchObject({ accepted: 6, rejected: 15, n: 21, books: 2 });

    const report = studyReport([one, two], { minVerdicts: 20 });
    expect(Object.fromEntries(report.map((row) => [row.ruleId, row.outcome]))).toEqual({
      "style/cliche": "off-by-default",
      "style/even": "stays-on", // exactly half is not more than half
      "style/filter": "stays-on",
      "style/rare": "not-enough-data",
    });
    // Half rejected stays on, but the interval reaches past the threshold.
    expect(report.find((row) => row.ruleId === "style/even")!.settled).toBe(false);
    expect(studyDefaults([one, two], { minVerdicts: 20 })).toEqual(["style/cliche"]);
    expect(studyDefaults([one, two], { minVerdicts: 3 })).toEqual(["style/cliche", "style/rare"]);
    expect(studyDefaults([one, two], { minVerdicts: 20, rejectAbove: 0.4 })).toEqual(["style/cliche", "style/even"]);
  });

  it("calls a decision settled when the interval clears the threshold", () => {
    const [row] = studyReport([verdictStats(book("style/cliche", 5, 45))]);
    expect(row).toMatchObject({ outcome: "off-by-default", settled: true });
  });
});
