import { applyRuntimeStateDelta, type RuntimeStateDelta, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import { DiagnosticSchema, sortDiagnostics, type Diagnostic } from "@plotlint/diagnostics";
import type { Rule, RuleContext } from "./types.js";
import { deadEntityActs } from "./rules/dead-entity-acts.js";

export const builtinRules: ReadonlyArray<Rule> = [deadEntityActs];

function run(rules: ReadonlyArray<Rule>, context: RuleContext): Diagnostic[] {
  const diagnostics = rules.flatMap((rule) => rule.check(context));
  // A rule that emits a malformed finding is a bug in the rule; fail loudly.
  return sortDiagnostics(diagnostics.map((diagnostic) => DiagnosticSchema.parse(diagnostic)));
}

/** Check a persisted snapshot, e.g. a whole book's current state. */
export function checkSnapshot(
  snapshot: RuntimeStateSnapshot,
  rules: ReadonlyArray<Rule> = builtinRules,
): Diagnostic[] {
  return run(rules, { snapshot });
}

/**
 * Check a settler delta before it is committed: apply it with InkOS's reducer,
 * run the rules over the proposed state and keep only findings in the delta's chapter.
 */
export function checkDelta(
  previous: RuntimeStateSnapshot,
  delta: RuntimeStateDelta,
  rules: ReadonlyArray<Rule> = builtinRules,
): { next: RuntimeStateSnapshot; diagnostics: Diagnostic[] } {
  const next = applyRuntimeStateDelta({ snapshot: previous, delta });
  const diagnostics = run(rules, { snapshot: next, previous, delta })
    .filter((diagnostic) => diagnostic.chapter === delta.chapter);
  return { next, diagnostics };
}
