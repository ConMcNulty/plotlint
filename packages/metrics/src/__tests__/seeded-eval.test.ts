import { builtinRules, RuleRegistry } from "@plotlint/rules";
import { loadCorpusBook, metricMutators, scoreRules, type RuleEvalResult } from "@plotlint/rules/eval";
import { beforeAll, describe, expect, it } from "vitest";
import { createMetricRules, METRIC_RULE_IDS, metricStateRules } from "../index.js";

// The seeded-error eval's metric mutators (in @plotlint/rules/eval, which cannot
// import this package) scored with the metric rules on the wenlow corpus.

let result: RuleEvalResult;
beforeAll(async () => {
  const clean = await loadCorpusBook("wenlow");
  result = scoreRules(clean, metricMutators, { registry: new RuleRegistry([...builtinRules, ...metricStateRules()]), textRules: createMetricRules() });
}, 60_000);

describe("seeded-error eval of the metric rules", () => {
  it("has ten or more mutants per metric rule and catches most of them", () => {
    for (const id of [...METRIC_RULE_IDS, "metrics/repeated-phrase"]) {
      const score = result.rules.find((rule) => rule.ruleId === id)!;
      expect(score.mutants, id).toBeGreaterThanOrEqual(10);
      expect(score.recall!, id).toBeGreaterThanOrEqual(0.8);
    }
    expect(result.skipped).toEqual([]);
  });

  it("misses only the mutants marked as expected misses", () => {
    const misses = result.rules.flatMap((rule) => rule.outcomes).filter((o) => !o.caught && !o.description.startsWith("Expected miss"));
    expect(misses.map((o) => o.id)).toEqual([]);
  });

  it("raises nothing on the clean book but the refrain, and no other rule fires on the prose mutants", () => {
    const clean = result.rules.flatMap((rule) => rule.cleanFindings);
    expect(clean.map((f) => f.ruleId)).toEqual(["metrics/repeated-phrase", "metrics/repeated-phrase"]);
    expect(clean.every((f) => f.summary.includes("the river went past"))).toBe(true);
    expect(result.rules.flatMap((rule) => rule.collateral)).toEqual([]);
  });
});
