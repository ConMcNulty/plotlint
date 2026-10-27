import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule, RuleContext } from "../types.js";
import { findText, lastChapter, matchesFact, resolveChapter, type FactPattern, type Invariant, type InvariantCheck } from "../invariants.js";
import { factFinding, normalize } from "./facts.js";

// Runs the author's approved invariants (see invariants.ts). Each violation is a
// finding whose code is the invariant's id, so `inkos lint suppress --fingerprint`
// and the problems panel can tell one invariant from another, and whose summary
// quotes the author's own words.

/** Up to this many facts are cited per finding, so a busy chapter does not bury it. */
const MAX_CITED = 3;

const ID = "continuity/invariant";

const brief = (fact: CurrentStateFact) => `${fact.subject} · ${fact.predicate} · ${fact.object}`;
const describe = (found: CurrentStateFact[]) => `${brief(found[0]!)}${found.length > 1 ? ` and ${found.length - 1} more` : ""}`;

/** The first chapter within lo..hi (inclusive) in which the fact is in force, or null. */
function firstValidIn(fact: CurrentStateFact, lo: number, hi: number): number | null {
  const from = Math.max(fact.validFromChapter, lo);
  const until = Math.min(fact.validUntilChapter ?? Infinity, hi);
  // A fact superseded in the chapter that added it (until < from) is never in force.
  return from <= until ? from : null;
}

function finding(invariant: Invariant, chapter: number, detail: string, evidence: Array<readonly [string, CurrentStateFact]>): Diagnostic {
  return {
    ...factFinding({ id: ID, layer: "continuity" }, {
      chapter,
      summary: `Invariant "${invariant.text}" fails in chapter ${chapter}: ${detail}.`,
      evidence,
      severity: invariant.severity ?? "error",
    }),
    code: invariant.id,
  };
}

/** One finding per chapter in which matching facts come into force within lo..hi. */
function factsInForce(invariant: Invariant, facts: ReadonlyArray<CurrentStateFact>, pattern: FactPattern, lo: number, hi: number): Diagnostic[] {
  const byChapter = new Map<number, CurrentStateFact[]>();
  for (const fact of facts) {
    if (!matchesFact(pattern, fact)) continue;
    const chapter = firstValidIn(fact, lo, hi);
    if (chapter !== null) byChapter.set(chapter, [...(byChapter.get(chapter) ?? []), fact]);
  }
  return [...byChapter].sort(([a], [b]) => a - b).map(([chapter, found]) =>
    finding(invariant, chapter, describe(found), found.slice(0, MAX_CITED).map((fact) => ["fact", fact] as const)));
}

function requiresBefore(invariant: Invariant, check: Extract<InvariantCheck, { kind: "requires-before" }>, facts: ReadonlyArray<CurrentStateFact>): Diagnostic[] {
  const prerequisites = facts.filter((fact) => matchesFact(check.requires, fact));
  const byChapter = new Map<number, CurrentStateFact[]>();
  for (const fact of facts) {
    if (!matchesFact(check.fact, fact)) continue;
    if (fact.validUntilChapter !== null && fact.validUntilChapter < fact.validFromChapter) continue;
    const met = prerequisites.some((earlier) =>
      earlier !== fact
      && (check.strict ? earlier.validFromChapter < fact.validFromChapter : earlier.validFromChapter <= fact.validFromChapter)
      && (!check.sameSubject || normalize(earlier.subject) === normalize(fact.subject)));
    if (!met) byChapter.set(fact.validFromChapter, [...(byChapter.get(fact.validFromChapter) ?? []), fact]);
  }
  return [...byChapter].sort(([a], [b]) => a - b).map(([chapter, found]) =>
    finding(invariant, chapter, `${describe(found)}, with nothing earlier that it requires`,
      found.slice(0, MAX_CITED).map((fact) => ["without its prerequisite", fact] as const)));
}

const CONTEXT = 40;

function textNotBefore(invariant: Invariant, check: Extract<InvariantCheck, { kind: "text-not-before" }>, context: RuleContext, before: number): Diagnostic[] {
  const findings: Diagnostic[] = [];
  for (const [chapter, text] of [...context.chapters ?? []].sort(([a], [b]) => a - b)) {
    if (chapter >= before) continue;
    // The first occurrence per chapter: one finding to fix per chapter, not one per mention.
    const [first, ...rest] = findText(check.text, text);
    if (!first) continue;
    const sourceId = `chapter:${chapter}`;
    const phrase = text.slice(first.start, first.end);
    const around = text.slice(Math.max(0, first.start - CONTEXT), Math.min(text.length, first.end + CONTEXT)).replace(/\s+/gu, " ").trim();
    findings.push({
      code: invariant.id,
      ruleId: ID,
      layer: "continuity",
      severity: invariant.severity ?? "error",
      confidence: "deterministic",
      category: "quality",
      assessment: "issue",
      chapter,
      summary: `Invariant "${invariant.text}" fails in chapter ${chapter}: the text says "${phrase}"${rest.length ? ` (${rest.length + 1} times)` : ""}.`,
      evidence: [`text: "${around}"`],
      range: { sourceId, start: first.start, end: first.end },
      sourceRefs: [{ sourceId, quote: phrase }],
    });
  }
  return findings;
}

export const invariantRule: Rule = {
  id: ID,
  layer: "continuity",
  title: "Author-written invariants",
  rationale: "The author's own rules for this book, written in plain language and compiled to a check they approved (`inkos lint invariant`). A failing invariant is the story breaking a promise the author made to themselves.",
  check(context) {
    const invariants = context.book?.invariants?.invariants.filter((inv) => inv.status === "approved") ?? [];
    if (invariants.length === 0) return [];
    const facts = context.snapshot.currentState.facts;
    const last = lastChapter(context.snapshot, context.chapters);
    return invariants.flatMap((invariant) => {
      const { check } = invariant;
      switch (check.kind) {
        case "never":
          return factsInForce(invariant, facts, check.fact,
            check.from === undefined ? 0 : resolveChapter(check.from, last),
            check.until === undefined ? Infinity : resolveChapter(check.until, last));
        case "not-before":
          return factsInForce(invariant, facts, check.fact, 0, resolveChapter(check.chapter, last) - 1);
        case "not-after":
          return factsInForce(invariant, facts, check.fact, resolveChapter(check.chapter, last) + 1, Infinity);
        case "requires-before":
          return requiresBefore(invariant, check, facts);
        case "text-not-before":
          return textNotBefore(invariant, check, context, resolveChapter(check.chapter, last));
        case "unsupported":
          return [];
      }
    });
  },
};
