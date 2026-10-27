import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { isDeathFact, STATUS_PREDICATES } from "./dead-entity-acts.js";
import { factFinding, forEachOverlappingPair, groupBy, normalize, parseQuantity } from "./facts.js";

// Properties a character has exactly one value of at a time, read only where the
// value is unambiguous. Location and possession have their own rules
// (two-places-at-once, item-two-holders) and are not repeated here. Free-text
// properties (title, mood, goal) are not checked: two phrasings of one value
// cannot be told apart from two values without a judged layer.

const ALIVE_OBJECT = /^(alive|living|still alive|活着|存活|在世|健在|未死|还活着)$/u;
const TRUE_OBJECT = /^(true|yes|是)$/u;

function isAliveFact(fact: CurrentStateFact): boolean {
  const predicate = normalize(fact.predicate);
  if (!STATUS_PREDICATES.has(predicate)) return false;
  const object = fact.object.trim().toLowerCase();
  if (predicate === "alive" || predicate === "存活") return TRUE_OBJECT.test(object);
  return ALIVE_OBJECT.test(object);
}

const AGE_PREDICATES = new Set(["age", "currentage", "年龄", "年纪", "岁数", "当前年龄"]);
const AGE_UNIT = /^(|years?|years old|yrs?|y\/o|yo|岁|周岁|虚岁)$/iu;

/** Age in years when the fact states one plainly ("17", "17 years old", "十七岁"). */
function readAge(fact: CurrentStateFact): number | null {
  if (!AGE_PREDICATES.has(normalize(fact.predicate))) return null;
  const quantity = parseQuantity(fact.object);
  if (!quantity || quantity.value < 0 || !AGE_UNIT.test(quantity.unit.trim())) return null;
  // "虚岁" counts one more year than "周岁"; don't compare across the two reckonings.
  return /虚岁/u.test(quantity.unit) ? null : quantity.value;
}

type Reading = { readonly fact: CurrentStateFact; readonly property: "life" | "age"; readonly value: string };

function read(fact: CurrentStateFact): Reading | null {
  if (isDeathFact(fact)) return { fact, property: "life", value: "dead" };
  if (isAliveFact(fact)) return { fact, property: "life", value: "alive" };
  const age = readAge(fact);
  return age === null ? null : { fact, property: "age", value: String(age) };
}

export const singleValuedConflict: Rule = {
  id: "continuity/single-valued-conflict",
  layer: "continuity",
  rationale: "Some properties have one value at a time: a character is alive or dead, and has one age. Two different values valid in the same chapter mean an old fact was never ended.",
  check({ snapshot }) {
    const readings = snapshot.currentState.facts.map(read).filter((reading): reading is Reading => reading !== null);
    const diagnostics: Diagnostic[] = [];

    for (const group of groupBy(readings, (r) => `${r.property}\u0000${normalize(r.fact.subject)}`).values()) {
      const byFact = new Map(group.map((r) => [r.fact, r]));
      forEachOverlappingPair(group.map((r) => r.fact), (factA, factB, chapter) => {
        const a = byFact.get(factA)!;
        const b = byFact.get(factB)!;
        if (a.value === b.value) return;
        const summary = a.property === "life"
          ? `${factA.subject} is recorded as both alive and dead in chapter ${chapter}.`
          : `${factA.subject} has two ages in chapter ${chapter}: ${a.value} and ${b.value}.`;
        diagnostics.push(factFinding(this, { chapter, summary, evidence: [[a.property, factA], [b.property, factB]] }));
      });
    }
    return diagnostics;
  },
};
