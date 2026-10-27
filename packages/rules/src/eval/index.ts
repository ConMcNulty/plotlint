// `@plotlint/rules/eval`: the seeded-error evaluation (Node only; it reads the
// corpus from disk). See eval/README section in eval/REPORT.md for how to run it.
import type { Mutator } from "./mutant.js";
import { currentMutators } from "./mutators/current.js";
import { futureMutators } from "./mutators/future.js";

export type { CleanBook, FactChange, FactSpec, Mutant, MutantSpec, Mutator, TextEdit } from "./mutant.js";
export { buildMutant, fact, insertAfter, mutator, rewrite } from "./mutant.js";
export { corpusRoot, loadCorpusBook } from "./corpus.js";
export type { FindingRef, MutantOutcome, RuleEvalOptions, RuleEvalResult, RuleScore } from "./score.js";
export { activeMutators, evalBook, runRules, scoreRules, snapshotOf } from "./score.js";
export * from "./mutators/current.js";
export * from "./mutators/future.js";
export type { AuditorBaseline, AuditorIssue, AuditorRuleScore, AuditorRun, RunAuditorOptions } from "./auditor.js";
export { auditorIssueMatches, runAuditorBaseline, scoreAuditor } from "./auditor.js";
export { renderReport } from "./report.js";

/** Every mutator, keyed by rule id; the harness runs those whose rule is registered. */
export const allMutators: ReadonlyArray<Mutator> = [...currentMutators, ...futureMutators];
