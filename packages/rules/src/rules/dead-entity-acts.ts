import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { factFinding, normalize, validAt } from "./facts.js";

// Settler facts are free-form subject-predicate-object strings in English or
// Chinese, so death is recognised from a small vocabulary rather than a type.
export const STATUS_PREDICATES = new Set([
  "status", "state", "condition", "alive", "lifestatus", "life", "vitalstatus", "health",
  "状态", "生死", "生死状态", "存活", "存活状态", "生命状态",
]);
const DEAD_OBJECT = /^(dead|deceased|killed|died|slain|murdered|executed|死亡|已死|已死亡|死了|身亡|阵亡|去世|已故|遇害|被杀)$/u;
const NOT_ALIVE_OBJECT = /^(false|no|not alive|否|不|无)$/u;

// Facts that may still change after a death without the character acting.
const POSTHUMOUS_PREDICATE = /(cause.?of.?death|death|died|buried|burial|grave|tomb|body|corpse|remains|remembered|memory|legacy|estate|inherit|will|mourn|funeral|ghost|spirit|死|葬|墓|遗|尸|悼|纪念|鬼|魂)/u;

export function isDeathFact(fact: CurrentStateFact): boolean {
  if (!STATUS_PREDICATES.has(normalize(fact.predicate))) return false;
  const object = fact.object.trim().toLowerCase();
  if (normalize(fact.predicate) === "alive" || normalize(fact.predicate) === "存活") return NOT_ALIVE_OBJECT.test(object);
  return DEAD_OBJECT.test(object);
}

export const deadEntityActs: Rule = {
  id: "continuity/dead-entity-acts",
  layer: "continuity",
  rationale: "A character recorded as dead should not gain new state (move, hold things, learn things) unless the story brings them back or the scene is a flashback.",
  check({ snapshot }) {
    const facts = snapshot.currentState.facts;
    const deaths = facts.filter(isDeathFact);
    const diagnostics: Diagnostic[] = [];

    for (const death of deaths) {
      const subject = normalize(death.subject);
      const later = facts.filter((fact) =>
        fact !== death
        && normalize(fact.subject) === subject
        && fact.validFromChapter > death.validFromChapter
        && validAt(death, fact.validFromChapter)
        && !isDeathFact(fact)
        && !STATUS_PREDICATES.has(normalize(fact.predicate))
        && !POSTHUMOUS_PREDICATE.test(fact.predicate.toLowerCase()));

      const byChapter = new Map<number, CurrentStateFact[]>();
      for (const fact of later) byChapter.set(fact.validFromChapter, [...(byChapter.get(fact.validFromChapter) ?? []), fact]);

      for (const [chapter, chapterFacts] of byChapter) {
        diagnostics.push(factFinding(this, {
          chapter,
          summary: `${death.subject} is recorded as dead since chapter ${death.validFromChapter}, but gains new state in chapter ${chapter}.`,
          evidence: [["death", death], ...chapterFacts.map((fact) => ["after", fact] as const)],
        }));
      }
    }
    return diagnostics;
  },
};
