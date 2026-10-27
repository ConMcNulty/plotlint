import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { factFinding, normalize, parseQuantity } from "./facts.js";

// Tracked resources, matched against whole English words of the predicate or
// its unit ("gold", "spirit stones", "HP") so short words don't hit inside
// others ("mp" in "camp"), and as substrings of Chinese predicates or units.
const RESOURCE_WORDS = new Set([
  "money", "gold", "silver", "copper", "coin", "cash", "fund", "saving", "wealth", "credit", "dollar", "crown", "ducat",
  "mana", "mp", "hp", "hitpoint", "healthpoint", "stamina", "qi", "ammo", "ammunition", "bullet", "arrow", "round",
  "ration", "supply", "provision", "fuel", "potion", "gem", "crystal", "spiritstone", "xp", "exp", "experience", "life", "live",
]);
const RESOURCE_CJK = /(钱|银两|银子|金子|金币|银币|铜币|铜钱|铜板|灵石|元石|晶石|仙玉|法力|灵力|真气|内力|魔力|体力|生命值|血量|气血|弹药|子弹|箭矢|积分|贡献点|经验|资金|存款|粮食|丹药|寿元)/u;

// Quantities that can legitimately be negative, or that record a change rather than an amount.
const SIGNED_QUANTITY = /(change|delta|diff|spent|spend|cost|lost|loss|gain|earned|income|debt|owed|owe|loan|deficit|overdraft|balance|price|temperature|temp|degree|reputation|favou?r|karma|relation|standing|modifier|bonus|penalty|floor|level|altitude|depth|变化|增减|消耗|花费|支出|损失|收入|欠|债|贷|赤字|余额|价格|温度|气温|声望|好感|关系|修正|加成|惩罚|楼层|海拔|深度)/iu;

// Crude plural folding, enough for "coins", "arrows", "supplies", "hit points".
const singular = (word: string) =>
  word.length > 3 && word.endsWith("ies") ? `${word.slice(0, -3)}y`
  : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1)
  : word;

function namesResource(text: string): boolean {
  if (RESOURCE_CJK.test(text)) return true;
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).map(singular);
  // Single words and adjacent pairs ("spirit stones", "hit points").
  return words.some((word, i) => RESOURCE_WORDS.has(word) || (i + 1 < words.length && RESOURCE_WORDS.has(word + words[i + 1])));
}

export function negativeAmount(fact: CurrentStateFact): number | null {
  if (SIGNED_QUANTITY.test(fact.predicate)) return null;
  const quantity = parseQuantity(fact.object);
  if (!quantity || quantity.value >= 0) return null;
  if (quantity.unit && SIGNED_QUANTITY.test(quantity.unit)) return null;
  return namesResource(fact.predicate) || namesResource(quantity.unit) ? quantity.value : null;
}

export const negativeResource: Rule = {
  id: "continuity/negative-resource",
  layer: "continuity",
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
