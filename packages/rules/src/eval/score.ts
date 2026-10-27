import type { CurrentStateFact, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { BookRuleData } from "../book.js";
import type { ChapterTexts } from "../evidence.js";
import { builtinRegistry, checkSnapshot } from "../engine.js";
import type { RuleRegistry } from "../registry.js";
import type { CleanBook, Mutant, Mutator } from "./mutant.js";

// Scoring the rules on a seeded-error corpus:
// - recall: the share of a rule's mutants on which it fires in the mutant's chapter;
// - false alarms: the rule's findings on the clean book (count, and per chapter),
//   plus "collateral", its new findings on other rules' mutants. A finding of the
//   seeded rule in another chapter is an "echo" (the same error seen again later)
//   and counted apart, not as a false alarm.
// Findings are compared by rule, chapter and summary, so a clean finding that
// recurs on a mutant is not counted twice.

export function snapshotOf(facts: ReadonlyArray<CurrentStateFact>, chapters: ChapterTexts): RuntimeStateSnapshot {
  const last = Math.max(0, ...chapters.keys());
  return {
    manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: last, projectionVersion: 1 },
    currentState: { chapter: last, facts: facts.map((fact) => ({ ...fact })) },
    hooks: { hooks: [] },
    chapterSummaries: { rows: [] },
  };
}

export interface FindingRef {
  readonly ruleId: string;
  readonly chapter: number | undefined;
  readonly summary: string;
}

export interface MutantOutcome {
  readonly id: string;
  readonly ruleId: string;
  readonly chapter: number;
  readonly description: string;
  readonly caught: boolean;
  /** Findings of the seeded rule in other chapters. */
  readonly echoes: ReadonlyArray<FindingRef>;
  /** New findings of other rules. */
  readonly collateral: ReadonlyArray<FindingRef>;
}

export interface RuleScore {
  readonly ruleId: string;
  /** Mutants seeded for this rule; 0 when no mutator targets it. */
  readonly mutants: number;
  readonly caught: number;
  readonly recall: number | null;
  readonly cleanFindings: ReadonlyArray<FindingRef>;
  /** Clean findings per clean chapter. */
  readonly cleanRate: number;
  /** This rule's new findings on mutants seeded for other rules. */
  readonly collateral: ReadonlyArray<FindingRef & { readonly mutant: string }>;
  /** Collateral per mutant it could fire on. */
  readonly collateralRate: number;
  readonly outcomes: ReadonlyArray<MutantOutcome>;
}

export interface RuleEvalResult {
  readonly book: string;
  readonly chapters: number;
  readonly rules: ReadonlyArray<RuleScore>;
  /** Mutators whose rule is not registered, so they were not run. */
  readonly skipped: ReadonlyArray<string>;
  readonly mutants: ReadonlyArray<Mutant>;
}

export interface RuleEvalOptions {
  readonly registry?: RuleRegistry;
}

const ref = (d: Diagnostic): FindingRef => ({ ruleId: d.ruleId ?? d.code, chapter: d.chapter, summary: d.summary });
const keyOf = (r: FindingRef) => `${r.ruleId}\u0000${r.chapter}\u0000${r.summary}`;

/** The mutators whose rule is registered, and the ids of those skipped. */
export function activeMutators(mutators: ReadonlyArray<Mutator>, registry: RuleRegistry = builtinRegistry): { active: Mutator[]; skipped: string[] } {
  const active = mutators.filter((m) => registry.get(m.ruleId) !== undefined);
  return { active, skipped: mutators.filter((m) => !active.includes(m)).map((m) => m.ruleId) };
}

/** The clean book's data with every active mutator's data on top (a travel graph, invariants). */
export function evalBook(clean: CleanBook, mutators: ReadonlyArray<Mutator>): BookRuleData {
  return mutators.reduce<BookRuleData>((book, m) => ({ ...book, ...m.book?.(clean) }), clean.book);
}

export function runRules(facts: ReadonlyArray<CurrentStateFact>, chapters: ChapterTexts, book: BookRuleData, registry: RuleRegistry): FindingRef[] {
  return checkSnapshot(snapshotOf(facts, chapters), { rules: registry, chapters, book }).map(ref);
}

export function scoreRules(clean: CleanBook, mutators: ReadonlyArray<Mutator>, options: RuleEvalOptions = {}): RuleEvalResult {
  const registry = options.registry ?? builtinRegistry;
  const { active, skipped } = activeMutators(mutators, registry);
  const book = evalBook(clean, active);
  const cleanFindings = runRules(clean.facts, clean.chapters, book, registry);
  const cleanKeys = new Set(cleanFindings.map(keyOf));
  const mutants = active.flatMap((m) => m.mutants(clean));

  const outcomes = mutants.map((mutant): MutantOutcome => {
    const found = runRules(mutant.facts, mutant.chapters, { ...book, ...mutant.book }, registry).filter((f) => !cleanKeys.has(keyOf(f)));
    const own = found.filter((f) => f.ruleId === mutant.ruleId);
    return {
      id: mutant.id, ruleId: mutant.ruleId, chapter: mutant.chapter, description: mutant.description,
      caught: own.some((f) => f.chapter === mutant.chapter),
      echoes: own.filter((f) => f.chapter !== mutant.chapter),
      collateral: found.filter((f) => f.ruleId !== mutant.ruleId),
    };
  });

  const rules = registry.list().map((rule): RuleScore => {
    const mine = outcomes.filter((o) => o.ruleId === rule.id);
    const caught = mine.filter((o) => o.caught).length;
    const collateral = outcomes.flatMap((o) => o.collateral.filter((f) => f.ruleId === rule.id).map((f) => ({ ...f, mutant: o.id })));
    const others = outcomes.length - mine.length;
    const onClean = cleanFindings.filter((f) => f.ruleId === rule.id);
    return {
      ruleId: rule.id,
      mutants: mine.length,
      caught,
      recall: mine.length ? caught / mine.length : null,
      cleanFindings: onClean,
      cleanRate: onClean.length / Math.max(1, clean.chapters.size),
      collateral,
      collateralRate: others ? collateral.length / others : 0,
      outcomes: mine,
    };
  });
  return { book: clean.name, chapters: clean.chapters.size, rules, skipped, mutants };
}
