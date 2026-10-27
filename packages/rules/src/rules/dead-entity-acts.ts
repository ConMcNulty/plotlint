import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { hasKind } from "../predicates.js";
import { factFinding, normalize, validAt } from "./facts.js";

// Settler facts are free-form subject-predicate-object strings in English or
// Chinese, so a status fact is recognised from its kind or a small vocabulary of
// predicate names, and death from a small vocabulary of objects.
// An English death word may carry its manner ("murdered with throat cut",
// "killed by Tomas"), but only after a preposition, so "dead tired" is not a death.
const DEAD_OBJECT = /^(dead|deceased|killed|died|slain|murdered|executed|drowned)(\s+(by|with|from|of|in|at|on)\s.*)?$|^(死亡|已死|已死亡|死了|身亡|阵亡|去世|已故|遇害|被杀)$/u;
const NOT_ALIVE_OBJECT = /^(false|no|not alive|否|不|无)$/u;

// Extractors also write death as a plain copula ("Harrow · is · dead") or as the
// manner of death ("Harrow · died from · a cut throat"). The copulas count only
// with a dead object, and are not status predicates elsewhere: "is" carries
// roles and traits too, which are not single-valued.
const COPULA_PREDICATES = new Set(["is", "was", "isnow", "became", "becomes", "是", "已经", "成了", "变成"]);
const DEATH_PREDICATES = new Set([
  "died", "diedof", "diedfrom", "diedby", "diedin", "diedat", "waskilledby", "killedby", "murderedby", "slainby",
  "死于", "死在", "被杀", "遇害",
]);

// Facts that may still change after a death without the character acting.
const POSTHUMOUS_PREDICATE = /(cause.?of.?death|death|died|buried|burial|grave|tomb|body|corpse|remains|remembered|memory|legacy|estate|inherit|will|mourn|funeral|ghost|spirit|死|葬|墓|遗|尸|悼|纪念|鬼|魂)/u;

export function isDeathFact(fact: CurrentStateFact): boolean {
  const predicate = normalize(fact.predicate);
  if (DEATH_PREDICATES.has(predicate)) return true;
  if (!hasKind(fact, "status") && !COPULA_PREDICATES.has(predicate)) return false;
  const object = fact.object.trim().toLowerCase();
  if (predicate === "alive" || predicate === "存活") return NOT_ALIVE_OBJECT.test(object);
  return DEAD_OBJECT.test(object);
}

export const deadEntityActs: Rule = {
  id: "continuity/dead-entity-acts",
  layer: "continuity",
  rationale: "A character recorded as dead should not gain new state (move, hold things, learn things) unless the story brings them back or the scene is a flashback.",
  check({ snapshot }) {
    const facts = snapshot.currentState.facts;
    // One finding per character and chapter: when several facts record the same
    // death ("is · dead" and "died from · ..."), cite the earliest one still valid.
    const findings = new Map<string, { death: CurrentStateFact; chapter: number; after: CurrentStateFact[] }>();
    const deaths = facts.filter(isDeathFact).sort((a, b) => a.validFromChapter - b.validFromChapter);

    for (const death of deaths) {
      const subject = normalize(death.subject);
      for (const fact of facts) {
        if (fact === death
          || normalize(fact.subject) !== subject
          || fact.validFromChapter <= death.validFromChapter
          || !validAt(death, fact.validFromChapter)
          || isDeathFact(fact)
          || hasKind(fact, "status")
          || POSTHUMOUS_PREDICATE.test(fact.predicate.toLowerCase())) continue;
        const key = `${subject}\u0000${fact.validFromChapter}`;
        const finding = findings.get(key) ?? { death, chapter: fact.validFromChapter, after: [] };
        if (finding.death === death) finding.after.push(fact);
        findings.set(key, finding);
      }
    }

    const diagnostics: Diagnostic[] = [];
    for (const { death, chapter, after } of findings.values()) {
      diagnostics.push(factFinding(this, {
        chapter,
        summary: `${death.subject} is recorded as dead since chapter ${death.validFromChapter}, but gains new state in chapter ${chapter}.`,
        evidence: [["death", death], ...after.map((fact) => ["after", fact] as const)],
      }));
    }
    return diagnostics;
  },
};
