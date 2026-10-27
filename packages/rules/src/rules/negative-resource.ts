import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { hasKind, namesResource } from "../predicates.js";
import { factFinding, normalize, parseQuantity } from "./facts.js";

// Quantities that can legitimately be negative, or that record a change rather than an amount.
const SIGNED_QUANTITY = /(change|delta|diff|spent|spend|cost|lost|loss|gain|earned|income|debt|owed|owe|loan|deficit|overdraft|balance|price|temperature|temp|degree|reputation|favou?r|karma|relation|standing|modifier|bonus|penalty|floor|level|altitude|depth|变化|增减|消耗|花费|支出|损失|收入|欠|债|贷|赤字|余额|价格|温度|气温|声望|好感|关系|修正|加成|惩罚|楼层|海拔|深度)/iu;

export function negativeAmount(fact: CurrentStateFact): number | null {
  if (SIGNED_QUANTITY.test(fact.predicate)) return null;
  const quantity = parseQuantity(fact.object);
  if (!quantity || quantity.value >= 0) return null;
  if (quantity.unit && SIGNED_QUANTITY.test(quantity.unit)) return null;
  // A resource by the settler's label, its predicate ("gold") or its unit ("-5 arrows").
  return hasKind(fact, "resource") || namesResource(quantity.unit) ? quantity.value : null;
}

export const negativeResource: Rule = {
  id: "continuity/negative-resource",
  layer: "continuity",
  title: "Resource below zero",
  rationale: "Money, mana, ammunition and other tracked resources cannot drop below zero; a negative amount usually means a cost was applied twice or a gain was never recorded.",
  check({ snapshot }) {
    const facts = snapshot.currentState.facts;
    const diagnostics: Diagnostic[] = [];

    for (const fact of facts) {
      const amount = negativeAmount(fact);
      // A fact superseded in the chapter that added it was never current.
      if (amount === null || (fact.validUntilChapter !== null && fact.validUntilChapter < fact.validFromChapter)) continue;
      const chapter = fact.validFromChapter;
      // The value it replaced, when the reducer superseded the same subject and predicate.
      const before = facts.find((other) =>
        other !== fact
        && normalize(other.subject) === normalize(fact.subject)
        && normalize(other.predicate) === normalize(fact.predicate)
        && other.validUntilChapter === chapter - 1
        && other.validFromChapter <= chapter - 1);
      diagnostics.push(factFinding(this, {
        chapter,
        summary: before
          ? `${fact.subject}'s ${fact.predicate} goes below zero in chapter ${chapter}: ${before.object} to ${fact.object}.`
          : `${fact.subject}'s ${fact.predicate} is below zero in chapter ${chapter}: ${fact.object}.`,
        evidence: before ? [["before", before], ["negative", fact]] : [["negative", fact]],
      }));
    }
    return diagnostics;
  },
};
