import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { HOLDER_FIRST, ITEM_FIRST, type PossessionRelation } from "../predicates.js";
import { factFinding, forEachOverlappingPair, groupBy, nested, normalize, normalizeValue } from "./facts.js";

// Holding and owning are compared each only with itself, written holder-first
// or item-first (HOLDER_FIRST and ITEM_FIRST in predicates.ts, with the words
// left out of them). A settler's "possession" label does not say which side is
// the holder, so the direction still comes from the predicate name.

// An indefinite or counted object ("a sword", "two arrows", "一把剑") names a kind
// of thing, not one thing, so two holders of it are not a contradiction.
const GENERIC_ITEM = /^(a|an|some|any|several|many|one|two|three|four|five|\d+)\s|^[一两二三四五六七八九十几数]+[把个件枚只支张块本柄根颗套份些]|^\d/iu;

interface Possession {
  readonly fact: CurrentStateFact;
  readonly relation: PossessionRelation;
  readonly holder: string;
  readonly item: string;
}

export function readPossession(fact: CurrentStateFact): Possession | null {
  const predicate = normalize(fact.predicate);
  const holderFirst = HOLDER_FIRST[predicate];
  const itemFirst = ITEM_FIRST[predicate];
  const relation = holderFirst ?? itemFirst;
  if (!relation) return null;
  const [holder, item] = holderFirst ? [fact.subject, fact.object] : [fact.object, fact.subject];
  if (GENERIC_ITEM.test(item.trim())) return null;
  return { fact, relation, holder, item };
}

const RELATION_WORDS: Record<PossessionRelation, string> = { holds: "held", owns: "owned" };

export const itemTwoHolders: Rule = {
  id: "continuity/item-two-holders",
  layer: "continuity",
  rationale: "One object can be held (or owned) by only one character at a time. Two holders usually mean a hand-over was recorded without ending the old possession.",
  check({ snapshot }) {
    const possessions = snapshot.currentState.facts
      .map(readPossession)
      .filter((possession): possession is Possession => possession !== null && normalizeValue(possession.item) !== "");
    const diagnostics: Diagnostic[] = [];

    for (const group of groupBy(possessions, (p) => `${p.relation}\u0000${normalizeValue(p.item)}`).values()) {
      const byFact = new Map(group.map((p) => [p.fact, p]));
      forEachOverlappingPair(group.map((p) => p.fact), (factA, factB, chapter) => {
        const a = byFact.get(factA)!;
        const b = byFact.get(factB)!;
        // Same holder twice, or "Mira" and "Mira and Tomas": not two different holders.
        if (nested(normalizeValue(a.holder), normalizeValue(b.holder))) return;
        diagnostics.push(factFinding(this, {
          chapter,
          summary: `${a.item} is ${RELATION_WORDS[a.relation]} by both ${a.holder} and ${b.holder} in chapter ${chapter}.`,
          evidence: [["holder", factA], ["holder", factB]],
        }));
      });
    }
    return diagnostics;
  },
};
