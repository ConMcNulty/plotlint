// `@plotlint/rules/eval`: the seeded-error evaluation (Node only; it reads the
// corpus from disk). See eval/README section in eval/REPORT.md for how to run it.
import type { Mutator } from "./mutant.js";
import { currentMutators } from "./mutators/current.js";
import { futureMutators } from "./mutators/future.js";
import { structureMutators } from "./mutators/structure.js";
import { sceneMutators } from "./mutators/scenes.js";
import { genreMutators } from "./mutators/genre.js";
import { metricMutators } from "./mutators/metrics.js";

export type { CleanBook, FactChange, FactSpec, HookChange, Mutant, MutantSpec, Mutator, SceneChange, TextEdit } from "./mutant.js";
export { buildMutant, fact, hook, insertAfter, mutator, rewrite, transform } from "./mutant.js";
export { CORPUS_BOOKS, corpusRoot, loadCorpusBook } from "./corpus.js";
export type { FindingRef, MutantOutcome, RuleEvalOptions, RuleEvalResult, RuleScore, RunInput } from "./score.js";
export { activeMutators, corpusOf, evalBook, runRules, scoreBooks, scoreRules, snapshotOf } from "./score.js";
export * from "./mutators/current.js";
export * from "./mutators/future.js";
export * from "./mutators/structure.js";
export * from "./mutators/scenes.js";
export * from "./mutators/genre.js";
export * from "./mutators/metrics.js";
export type { AuditorBaseline, AuditorIssue, AuditorRuleScore, AuditorRun, RunAuditorOptions } from "./auditor.js";
export { auditorIssueMatches, runAuditorBaseline, scoreAuditor } from "./auditor.js";
export { renderReport } from "./report.js";

/** Every mutator, keyed by rule id; the harness runs those whose rule is registered, each on its corpus book. */
export const allMutators: ReadonlyArray<Mutator> = [...currentMutators, ...futureMutators, ...structureMutators, ...sceneMutators, ...genreMutators, ...metricMutators];
