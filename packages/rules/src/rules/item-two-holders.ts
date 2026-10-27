import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { factFinding, forEachOverlappingPair, groupBy, nested, normalize, normalizeValue } from "./facts.js";

// Holding (who has the thing on them) and owning (whose it is) are different
// relations: a thief holds what the merchant owns. Each is compared only with
// itself. A relation can be written holder-first ("Mira · holds · brass key")
// or item-first ("brass key · held by · Mira").
//
// Bare "has"/"have"/"有" are left out: settlers use them for traits, relatives
// and conditions ("has a fever", "has a sister"), which many characters share.
// "belongs to"/"属于" are left out too: they mostly record membership of a group.
// So are "keeps", "possesses" and "wields", which settlers also use for abstract
// things ("keeps a secret", "possesses magic") that many characters share.
type Relation = "holds" | "owns";

const HOLDER_FIRST: Record<string, Relation> = Object.fromEntries([
  ...["holds", "holding", "carries", "carrying", "inpossessionof", "hasinhand",
    "持有", "携带", "手持", "拿着", "握着", "随身携带", "身上带着", "怀揣"].map((p) => [p, "holds" as const]),
  ...["owns", "ownerof", "拥有"].map((p) => [p, "owns" as const]),
]);

const ITEM_FIRST: Record<string, Relation> = Object.fromEntries([
  ...["heldby", "carriedby", "possessedby", "holder", "currentholder", "bearer", "inthepossessionof",
    "持有者", "持有人", "携带者", "持有方"].map((p) => [p, "holds" as const]),
  ...["owner", "ownedby", "currentowner", "所有者", "所有人", "主人", "物主"].map((p) => [p, "owns" as const]),
]);

// An indefinite or counted object ("a sword", "two arrows", "一把剑") names a kind
// of thing, not one thing, so two holders of it are not a contradiction.
const GENERIC_ITEM = /^(a|an|some|any|several|many|one|two|three|four|five|\d+)\s|^[一两二三四五六七八九十几数]+[把个件枚只支张块本柄根颗套份些]|^\d/iu;

interface Possession {
  readonly fact: CurrentStateFact;
  readonly relation: Relation;
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

const RELATION_WORDS: Record<Relation, string> = { holds: "held", owns: "owned" };

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
