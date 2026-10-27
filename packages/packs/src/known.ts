import { builtinRegistry } from "@plotlint/rules";
import { createMetricRules, metricStateRules } from "@plotlint/metrics";

/** Harper's findings come in under one rule id, set like any other rule. */
export const HARPER_RULE_ID = "mechanics/harper";

/**
 * Every rule id the lint runs besides the packs' own style rules: the state
 * rules (continuity and structure), Harper, and the L2 metric rules. The CLI
 * and Studio expand pack globs (`metrics/*`) against these.
 */
export const knownRuleIds = (): string[] => [
  ...builtinRegistry.list().map((rule) => rule.id),
  HARPER_RULE_ID,
  ...createMetricRules().map((rule) => rule.id),
  ...metricStateRules().map((rule) => rule.id),
];
