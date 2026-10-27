import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendVerdicts } from "@plotlint/diagnostics/node";
import { verdictOfAction, type Verdict, type VerdictAction } from "@plotlint/diagnostics/verdicts";
import { adaptiveDecisions, adaptiveOverlay, RuleConfigFileSchema } from "../index.js";
import { loadAdaptiveOverlay } from "../node.js";

let clock = 0;
const verdict = (ruleId: string, fingerprint: string, action: VerdictAction): Verdict => ({
  ruleId,
  fingerprint,
  verdict: verdictOfAction(action),
  action,
  at: new Date(Date.UTC(2026, 9, 27, 0, 0, clock++)).toISOString(),
  layer: "style",
  confidence: "deterministic",
});

/** `pattern` read left to right as the order the author decided: a = accepted, r = rejected. */
const history = (ruleId: string, pattern: string) =>
  [...pattern].map((c, i) => verdict(ruleId, `${ruleId}#${i}`, c === "a" ? "fix" : "intentional"));

describe("adaptiveOverlay", () => {
  it("leaves rules alone below the sample size or at half rejected and below", () => {
    const verdicts = [...history("style/a", "rrrr"), ...history("style/b", "rrraaa"), ...history("style/c", "aaaaar")];
    expect(adaptiveOverlay(verdicts)).toEqual({ version: 1, rules: {} });
  });

  it("lowers a rule the author keeps rejecting to a note, then off with a larger sample", () => {
    const overlay = adaptiveOverlay([
      ...history("style/note", "rrrar"), // 5 verdicts, 80% rejected
      ...history("style/off", "rarrrrrrarrrrrr"), // 15 verdicts, rejection stays high
    ]);
    expect(overlay).toEqual({ version: 1, rules: { "style/note": "note", "style/off": "off" } });
    expect(RuleConfigFileSchema.parse(overlay)).toEqual(overlay);
  });

  it("stops short of off when the recent verdicts turned to accepting", () => {
    const [decision] = adaptiveDecisions(history("style/x", "rrrrrrrrrrraaaa"));
    expect(decision).toMatchObject({ ruleId: "style/x", setting: "note", n: 15 });
    expect(decision!.recentRejectRate).toBeCloseTo(0.2);
  });

  it("counts the latest verdict per finding, so a changed mind lifts the overlay", () => {
    const rejected = history("style/x", "rrrrr");
    expect(adaptiveOverlay(rejected).rules).toEqual({ "style/x": "note" });
    const changed = rejected.slice(0, 3).map((v) => verdict(v.ruleId, v.fingerprint, "edited"));
    expect(adaptiveOverlay([...rejected, ...changed]).rules).toEqual({});
  });

  it("takes the thresholds as options", () => {
    const verdicts = history("style/x", "rra");
    expect(adaptiveOverlay(verdicts, { minVerdicts: 3 }).rules).toEqual({ "style/x": "note" });
    expect(adaptiveOverlay(verdicts, { minVerdicts: 3, offAfter: 3 }).rules).toEqual({ "style/x": "off" });
    expect(adaptiveOverlay(verdicts, { minVerdicts: 3, rejectAbove: 0.7 }).rules).toEqual({});
  });

  it("reads a book's verdicts file", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "plotlint-adaptive-"));
    try {
      expect(await loadAdaptiveOverlay(bookDir)).toEqual({ version: 1, rules: {} });
      await appendVerdicts(bookDir, history("style/x", "rrrrr"));
      expect(await loadAdaptiveOverlay(bookDir)).toEqual({ version: 1, rules: { "style/x": "note" } });
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });
});
