import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { hasKind } from "../predicates.js";
import { isDeathFact, POSTHUMOUS_PREDICATE } from "./dead-entity-acts.js";
import { factFinding, normalize, validAt } from "./facts.js";

// dead-entity-acts judges facts while a death is still recorded. This rule
// catches the other half: a death that ends, after which the character is alive
// or acting again. A return from the dead can be the plot (a faked death, a
// resurrection), so it is a warning to confirm, not an error.

// Status values that are not a life: a later "buried" or "missing" does not bring anyone back.
const NOT_ALIVE_STATUS = /(buried|burial|missing|unknown|corpse|body|remains|ghost|spirit|undead|葬|失踪|下落不明|未知|尸|鬼|魂)/u;

/** Up to this many later facts are cited, so a busy chapter does not bury the finding. */
const MAX_CITED = 3;

export const deadThenAlive: Rule = {
  id: "continuity/dead-then-alive",
  layer: "continuity",
  title: "Dead characters alive again",
  rationale: "A character recorded as dead who is later alive again is either a deliberate return (a faked death, a resurrection) or a continuity slip. If it is deliberate, mark it as intentional.",
  check({ snapshot }) {
    const facts = snapshot.currentState.facts;
    const deaths = facts.filter(isDeathFact);
    // One finding per character and chapter: several facts may record the same
    // death ("is · dead" and "died from · ...") and all end together.
    const findings = new Map<string, Diagnostic>();

    for (const death of [...deaths].sort((a, b) => a.validFromChapter - b.validFromChapter)) {
      // A death superseded in the chapter that recorded it was never valid: a correction, not a return.
      if (death.validUntilChapter === null || death.validUntilChapter < death.validFromChapter) continue;
      const subject = normalize(death.subject);
      const sameSubject = facts.filter((fact) => normalize(fact.subject) === subject);
      const deadAt = (chapter: number) => deaths.some((other) => normalize(other.subject) === subject && validAt(other, chapter));

      const after = sameSubject.filter((fact) =>
        fact !== death
        && fact.validFromChapter > death.validUntilChapter!
        && !isDeathFact(fact)
        && !POSTHUMOUS_PREDICATE.test(fact.predicate.toLowerCase())
        && !(hasKind(fact, "status") && NOT_ALIVE_STATUS.test(fact.object.toLowerCase()))
        && !deadAt(fact.validFromChapter));
      if (after.length === 0) continue;

      const chapter = Math.min(...after.map((fact) => fact.validFromChapter));
      // A status fact ("alive", "wounded") says it most plainly, so cite it first.
      const cited = after
        .filter((fact) => fact.validFromChapter === chapter)
        .sort((a, b) => Number(hasKind(b, "status")) - Number(hasKind(a, "status")))
        .slice(0, MAX_CITED);
      const key = `${subject}\u0000${chapter}`;
      if (findings.has(key)) continue;
      const status = cited.find((fact) => hasKind(fact, "status"));
      findings.set(key, factFinding(this, {
        chapter,
        summary: status
          ? `${death.subject} is recorded as dead from chapter ${death.validFromChapter}, but is ${status.object} in chapter ${chapter}.`
          : `${death.subject} is recorded as dead from chapter ${death.validFromChapter}, but is active again in chapter ${chapter}.`,
        evidence: [["death", death], ...cited.map((fact) => ["alive again", fact] as const satisfies readonly [string, CurrentStateFact])],
      }));
    }
    return [...findings.values()];
  },
};
