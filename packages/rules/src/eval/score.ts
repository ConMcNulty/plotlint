import type { CurrentStateFact, HookRecord, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { BookRuleData } from "../book.js";
import type { ChapterTexts } from "../evidence.js";
import { builtinRegistry, checkSnapshot } from "../engine.js";
import type { RuleRegistry } from "../registry.js";
import type { TextRule } from "../text.js";
import type { CleanBook, Mutant, Mutator } from "./mutant.js";

// Scoring the rules on a seeded-error corpus:
// - recall: the share of a rule's mutants on which it fires in the mutant's chapter
//   (for a book-level mutant, at all);
// - false alarms: the rule's findings on the clean book (count, and per chapter),
//   plus "collateral", its new findings on other rules' mutants. A finding of the
//   seeded rule in another chapter is an "echo" (the same error seen again later)
//   and counted apart, not as a false alarm.
// Findings are compared by rule, chapter and summary, so a clean finding that
// recurs on a mutant is not counted twice. Text rules (the L2 metrics, which live
// in a package that depends on this one) are passed in and run on every chapter.

export function snapshotOf(facts: ReadonlyArray<CurrentStateFact>, chapters: ChapterTexts, hooks: ReadonlyArray<HookRecord> = []): RuntimeStateSnapshot {
  const last = Math.max(0, ...chapters.keys());
  return {
    manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: last, projectionVersion: 1 },
    currentState: { chapter: last, facts: facts.map((fact) => ({ ...fact })) },
    hooks: { hooks: hooks.map((hook) => ({ ...hook })) },
    chapterSummaries: { rows: [] },
  };
}

export interface FindingRef {
  readonly ruleId: string;
  readonly chapter: number | undefined;
  readonly summary: string;
  /** The corpus book, when the result covers several. */
  readonly book?: string;
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
  /** Text rules to run on every chapter beside the state rules (e.g. `createMetricRules()`). */
  readonly textRules?: ReadonlyArray<TextRule>;
}

const ref = (d: Diagnostic): FindingRef => ({ ruleId: d.ruleId ?? d.code, chapter: d.chapter, summary: d.summary });
const keyOf = (r: FindingRef) => `${r.ruleId}\u0000${r.chapter}\u0000${r.summary}`;

/** The rule ids a run covers: the registry's, then the text rules'. */
const ruleIds = (registry: RuleRegistry, textRules: ReadonlyArray<TextRule> = []) =>
  [...registry.list().map((rule) => rule.id), ...textRules.map((rule) => rule.id).filter((id) => !registry.get(id))];

/** The corpus book a mutator seeds. */
export const corpusOf = (m: Mutator) => m.corpus ?? "wenlow";

/** The mutators whose rule is registered (or among the text rules), and the ids of those skipped. */
export function activeMutators(mutators: ReadonlyArray<Mutator>, registry: RuleRegistry = builtinRegistry, textRules: ReadonlyArray<TextRule> = []): { active: Mutator[]; skipped: string[] } {
  const known = new Set(ruleIds(registry, textRules));
  const active = mutators.filter((m) => known.has(m.ruleId));
  return { active, skipped: [...new Set(mutators.filter((m) => !active.includes(m)).map((m) => m.ruleId))] };
}

/** The clean book's data with every active mutator's data on top (a travel graph, invariants); rule settings are merged by id. */
export function evalBook(clean: CleanBook, mutators: ReadonlyArray<Mutator>): BookRuleData {
  return mutators.reduce<BookRuleData>((book, m) => {
    const extra = m.book?.(clean);
    if (!extra) return book;
    const config = book.config && extra.config ? { version: 1 as const, rules: { ...book.config.rules, ...extra.config.rules } } : extra.config ?? book.config;
    return { ...book, ...extra, ...(config ? { config } : {}) };
  }, clean.book);
}

export interface RunInput {
  readonly facts: ReadonlyArray<CurrentStateFact>;
  readonly chapters: ChapterTexts;
  readonly hooks?: ReadonlyArray<HookRecord>;
  readonly book: BookRuleData;
}

/** Run the state rules, and the text rules on every chapter, over one version of the book. */
export function runRules(input: RunInput, registry: RuleRegistry = builtinRegistry, textRules: ReadonlyArray<TextRule> = []): FindingRef[] {
  const snapshot = snapshotOf(input.facts, input.chapters, input.hooks);
  const found = checkSnapshot(snapshot, { rules: registry, chapters: input.chapters, book: input.book }).map(ref);
  const off = new Set(Object.entries(input.book.config?.rules ?? {}).filter(([, setting]) => setting === "off" || (typeof setting === "object" && setting.severity === "off")).map(([id]) => id));
  for (const [chapter, text] of [...input.chapters].sort(([a], [b]) => a - b)) {
    for (const rule of textRules) {
      if (off.has(rule.id)) continue;
      const result = rule.check({ document: { sourceId: `chapter:${chapter}`, chapter, text }, snapshot });
      if (result instanceof Promise) throw new Error(`text rule ${rule.id} is async; the eval runs text rules synchronously`);
      found.push(...result.map(ref));
    }
  }
  return found;
}

/** Score the rules on one corpus book, with the mutators that seed it. */
export function scoreRules(clean: CleanBook, mutators: ReadonlyArray<Mutator>, options: RuleEvalOptions = {}): RuleEvalResult {
  const registry = options.registry ?? builtinRegistry;
  const textRules = options.textRules ?? [];
  const { active, skipped } = activeMutators(mutators.filter((m) => corpusOf(m) === clean.name), registry, textRules);
  const book = evalBook(clean, active);
  const cleanFindings = runRules({ facts: clean.facts, chapters: clean.chapters, hooks: clean.hooks, book }, registry, textRules);
  const cleanKeys = new Set(cleanFindings.map(keyOf));
  const mutants = active.flatMap((m) => m.mutants(clean));

  const outcomes = mutants.map((mutant): MutantOutcome => {
    const found = runRules({ facts: mutant.facts, chapters: mutant.chapters, hooks: mutant.hooks, book: { ...book, ...mutant.book } }, registry, textRules)
      .filter((f) => !cleanKeys.has(keyOf(f)));
    const own = found.filter((f) => f.ruleId === mutant.ruleId);
    const caught = mutant.scope === "book" ? own.length > 0 : own.some((f) => f.chapter === mutant.chapter);
    return {
      id: mutant.id, ruleId: mutant.ruleId, chapter: mutant.chapter, description: mutant.description,
      caught,
      echoes: mutant.scope === "book" ? [] : own.filter((f) => f.chapter !== mutant.chapter),
      collateral: found.filter((f) => f.ruleId !== mutant.ruleId),
    };
  });

  const rules = ruleIds(registry, textRules).map((ruleId): RuleScore => {
    const mine = outcomes.filter((o) => o.ruleId === ruleId);
    const caught = mine.filter((o) => o.caught).length;
    const collateral = outcomes.flatMap((o) => o.collateral.filter((f) => f.ruleId === ruleId).map((f) => ({ ...f, mutant: o.id })));
    const others = outcomes.length - mine.length;
    const onClean = cleanFindings.filter((f) => f.ruleId === ruleId);
    return {
      ruleId,
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

/**
 * Score the rules on several corpus books and add the results up: recall over
 * all of a rule's mutants, clean findings per clean chapter of every book, and
 * collateral per mutant of other rules. Findings and outcomes keep their book.
 */
export function scoreBooks(books: ReadonlyArray<CleanBook>, mutators: ReadonlyArray<Mutator>, options: RuleEvalOptions = {}): RuleEvalResult {
  const results = books.map((book) => scoreRules(book, mutators, options));
  if (results.length === 1) return results[0]!;
  const tag = <T extends FindingRef>(finding: T, book: string): T => ({ ...finding, book });
  const chapters = results.reduce((n, r) => n + r.chapters, 0);
  const totalMutants = results.reduce((n, r) => n + r.mutants.length, 0);
  const ids = [...new Set(results.flatMap((r) => r.rules.map((rule) => rule.ruleId)))];
  const rules = ids.map((ruleId): RuleScore => {
    const parts = results.map((r) => ({ book: r.book, score: r.rules.find((rule) => rule.ruleId === ruleId) }));
    const mutants = parts.reduce((n, p) => n + (p.score?.mutants ?? 0), 0);
    const caught = parts.reduce((n, p) => n + (p.score?.caught ?? 0), 0);
    const cleanFindings = parts.flatMap((p) => (p.score?.cleanFindings ?? []).map((f) => tag(f, p.book)));
    const collateral = parts.flatMap((p) => (p.score?.collateral ?? []).map((f) => tag(f, p.book)));
    return {
      ruleId, mutants, caught,
      recall: mutants ? caught / mutants : null,
      cleanFindings,
      cleanRate: cleanFindings.length / Math.max(1, chapters),
      collateral,
      collateralRate: totalMutants - mutants ? collateral.length / (totalMutants - mutants) : 0,
      outcomes: parts.flatMap((p) => p.score?.outcomes ?? []),
    };
  });
  // A rule skipped on one book may be active on another (its mutators seed only one).
  const active = new Set(rules.filter((r) => r.mutants > 0).map((r) => r.ruleId));
  const skipped = [...new Set(results.flatMap((r) => r.skipped))].filter((id) => !active.has(id));
  return { book: results.map((r) => r.book).join(" + "), chapters, rules, skipped, mutants: results.flatMap((r) => r.mutants) };
}
