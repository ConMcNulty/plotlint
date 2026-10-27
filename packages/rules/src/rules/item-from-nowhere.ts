import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { hasKind, HOLDER_FIRST, ITEM_FIRST } from "../predicates.js";
import { factFinding, nested, normalize, normalizeValue, validAt } from "./facts.js";

// "An entity can only use an object it possesses at that point." A use fact is
// judged against the possession facts around it:
//   - the item was destroyed, or the user lost or gave it away earlier and never got it back;
//   - someone else has held it since before the chapter of the use;
//   - the user gives away a tracked item (one with some earlier holder) they never had.
// Two holders at once is item-two-holders' finding, so a user who also holds the
// item is never flagged here. Untracked props (no possession fact at all) never
// fire: most objects a character uses were never recorded as held.

// Predicates whose subject uses the object. Bare "opens"/"打开" name what was opened, not
// the tool, so only "opens with" (or "opens · the vault with the key") reads the tool.
const USE_PREDICATES = new Set([
  "uses", "used", "using", "wields", "wielded", "wielding", "brandishes", "brandished",
  "fires", "fired", "reads", "read", "openswith", "openedwith", "unlockswith", "unlockedwith",
  "使用", "动用", "挥舞", "挥动", "祭出", "阅读", "翻阅",
]);
const USE_ITEM_FIRST = new Set(["usedby", "wieldedby", "firedby", "readby"]);
const OPEN_PREDICATES = new Set(["opens", "opened", "unlocks", "unlocked"]);

// Giving hands the object on, so it is a use and also a loss. "gives to"/"交给"/"递给"
// usually take the recipient as their object and are not read.
const GIVE_PREDICATES = new Set([
  "gives", "gave", "handsover", "handedover", "surrenders", "surrendered",
  "交出", "献出", "赠送", "赠予", "上交", "转交",
]);

// The user no longer has the object afterwards.
const LOSS_PREDICATES = new Set([
  "lost", "loses", "destroyed", "destroys", "discarded", "discards", "dropped", "drops", "sold", "sells",
  "threwaway", "throwsaway", "gaveaway", "givesaway", "burned", "burnt", "burns",
  "丢失", "遗失", "弄丢", "丢弃", "扔掉", "毁掉", "摧毁", "烧毁", "卖掉", "卖出", "失去",
]);

// Getting hold of something, recorded as an event or as a looser possession than
// HOLDER_FIRST's ("possesses" is also used for abstract things, see predicates.ts).
// These only ever count for the user (they had it), never against them.
const ACQUIRE_PREDICATES = new Set([
  "possesses", "possess", "possessed", "tookpossessionof", "takespossessionof", "acquired", "acquires",
  "obtained", "obtains", "received", "receives", "pickedup", "picksup", "found", "finds", "retrieved",
  "recovered", "regained", "stole", "steals", "bought", "buys", "took", "takes",
  "获得", "得到", "拿到", "捡到", "取得", "收到", "夺得", "买下", "找到", "取回", "偷走",
]);

// An item recorded as gone for good. "broken" and "lost" are left out: a broken sword
// can still be swung and a lost thing found.
const DESTROYED_OBJECT = /^(destroyed|shattered|burned|burnt|burned to ash|melted|incinerated|已毁|被毁|毁坏|粉碎|碎了|烧毁|销毁)$/u;

// An indefinite or counted object ("a sword", "two arrows", "一把剑") names a kind of thing, not one thing.
const GENERIC_ITEM = /^(a|an|some|any|several|many|one|two|three|four|five|\d+)\s|^[一两二三四五六七八九十几数]+[把个件枚只支张块本柄根颗套份些]|^\d/iu;
const POSSESSIVE = /^(his|her|their|its|my|your|our)\s+/iu;
// What follows the item in a use: "fires the pistol at Tomas", "gives the key to Mira".
const TRAILING = /\s+(to|at|on|against|into|toward|towards|for|from)\s+(.+)$/iu;

/** Split a compound possession object ("40 silver marks and a brass button") into its items. */
export const splitItems = (object: string): string[] =>
  object.split(/\s*[,;、]\s*|\s+and\s+/u).map((item) => item.trim()).filter(Boolean);

const words = (text: string) => text.trim().replace(/^(the|a|an)\s+/iu, "").split(/\s+/u).filter(Boolean).length;

/**
 * Whether two item names name the same object: equal, or one inside the other when
 * the shorter is specific enough (two words, or three CJK characters), so "key" is
 * not the same as "brass key" but "brass key" is the same as "old brass key".
 */
export function sameItem(a: string, b: string): boolean {
  const na = normalizeValue(a);
  const nb = normalizeValue(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (!nested(na, nb)) return false;
  const shorter = na.length <= nb.length ? a : b;
  return /\p{Script=Han}/u.test(shorter) ? normalizeValue(shorter).length >= 3 : words(shorter) >= 2;
}

/** One entity's link to one item: holding or owning it (a state), or getting it (an event). */
export interface Holding {
  readonly fact: CurrentStateFact;
  readonly kind: "holds" | "owns" | "acquires";
  readonly holder: string;
  readonly item: string;
}

/** Every holding a fact records, reading compound objects item by item. */
export function readHoldings(fact: CurrentStateFact): Holding[] {
  const predicate = normalize(fact.predicate);
  const holderFirst = HOLDER_FIRST[predicate] ?? (ACQUIRE_PREDICATES.has(predicate) ? "acquires" as const : undefined);
  const itemFirst = ITEM_FIRST[predicate];
  const kind = holderFirst ?? itemFirst;
  if (!kind) return [];
  const [holder, items] = holderFirst ? [fact.subject, splitItems(fact.object)] : [fact.object, [fact.subject]];
  return items.map((item) => ({ fact, kind, holder, item }));
}

interface Use {
  readonly fact: CurrentStateFact;
  readonly user: string;
  readonly item: string;
  /** Present for gives: the object changes hands. */
  readonly gives?: { readonly recipient: string | null };
}

function readUse(fact: CurrentStateFact): Use | null {
  const predicate = normalize(fact.predicate);
  let user = fact.subject;
  let item = fact.object.trim();
  let recipient: string | null = null;
  const gives = GIVE_PREDICATES.has(predicate);
  if (USE_ITEM_FIRST.has(predicate)) {
    [user, item] = [fact.object, fact.subject];
  } else if (OPEN_PREDICATES.has(predicate)) {
    const tool = /\swith\s+(.+)$/iu.exec(item);
    if (!tool) return null;
    item = tool[1]!;
  } else if (!gives && !USE_PREDICATES.has(predicate)) {
    return null;
  }
  const trailing = TRAILING.exec(item);
  if (trailing) {
    if (gives && trailing[1]!.toLowerCase() === "to") recipient = trailing[2]!;
    item = item.slice(0, trailing.index);
  }
  item = item.replace(POSSESSIVE, "").trim();
  if (!item || GENERIC_ITEM.test(item) || !normalizeValue(item)) return null;
  return { fact, user, item, ...(gives ? { gives: { recipient } } : {}) };
}

// "the lantern · is · destroyed": the copulas count only with a destroyed object.
const COPULA_PREDICATES = new Set(["is", "was", "isnow", "became", "becomes", "是", "已经", "成了", "变成"]);

const isDestroyed = (fact: CurrentStateFact) =>
  (hasKind(fact, "status") || COPULA_PREDICATES.has(normalize(fact.predicate)))
  && DESTROYED_OBJECT.test(fact.object.trim().toLowerCase());

const samePerson = (a: string, b: string) => nested(normalizeValue(a), normalizeValue(b));
const looseItem = (a: string, b: string) => nested(normalizeValue(a), normalizeValue(b));

export const itemFromNowhere: Rule = {
  id: "continuity/item-from-nowhere",
  layer: "continuity",
  title: "Item from nowhere",
  rationale: "An entity can only use an object it possesses at that point. Using something another character holds, or something destroyed, lost or given away earlier, usually means a hand-over or a recovery was never written.",
  check({ snapshot }) {
    const facts = snapshot.currentState.facts;
    const holdings = facts.flatMap(readHoldings);
    const uses = facts.map(readUse).filter((use): use is Use => use !== null);
    // Receiving an item in a hand-over counts as getting it.
    const receipts = uses.filter((use) => use.gives?.recipient);
    const findings = new Map<string, Diagnostic>();

    for (const use of uses) {
      const chapter = use.fact.validFromChapter;
      const mine = (holder: string) => samePerson(holder, use.user);
      // When the user got (or had) the item, by any possession fact or a receipt.
      const gotAt = [
        ...holdings.filter((h) => mine(h.holder) && looseItem(h.item, use.item) && h.fact.validFromChapter <= chapter)
          .map((h) => ({ chapter: h.fact.validFromChapter, valid: h.kind !== "acquires" && validAt(h.fact, chapter) })),
        ...receipts.filter((r) => r !== use && mine(r.gives!.recipient!) && looseItem(r.item, use.item) && r.fact.validFromChapter <= chapter)
          .map((r) => ({ chapter: r.fact.validFromChapter, valid: false })),
      ];
      // Holding it now: two holders is item-two-holders' finding, not this one.
      if (gotAt.some((g) => g.valid)) continue;
      const gotSince = (after: number) => gotAt.some((g) => g.chapter > after);

      const key = `${normalize(use.user)}\u0000${normalizeValue(use.item)}\u0000${chapter}`;
      if (findings.has(key)) continue;
      const add = (summary: string, evidence: Array<readonly [string, CurrentStateFact]>) =>
        findings.set(key, factFinding(this, { chapter, summary, evidence: [["use", use.fact], ...evidence] }));
      const verb = use.gives ? "gives" : "uses";

      const destroyed = facts.find((f) => sameItem(f.subject, use.item) && isDestroyed(f)
        && f.validFromChapter < chapter && validAt(f, chapter));
      if (destroyed) {
        add(`${use.user} ${verb} ${use.item} in chapter ${chapter}, but it was ${destroyed.object} in chapter ${destroyed.validFromChapter}.`, [["destroyed", destroyed]]);
        continue;
      }

      // Lost, destroyed or given away by the user in an earlier chapter, and not got back since.
      const lost = facts.find((f) => f !== use.fact && mine(f.subject) && f.validFromChapter < chapter
        && LOSS_PREDICATES.has(normalize(f.predicate)) && splitItems(f.object).some((item) => sameItem(item, use.item))
        && !gotSince(f.validFromChapter))
        ?? uses.find((u) => u !== use && u.gives && mine(u.user) && u.fact.validFromChapter < chapter
          && sameItem(u.item, use.item) && !gotSince(u.fact.validFromChapter))?.fact;
      if (lost) {
        add(`${use.user} ${verb} ${use.item} in chapter ${chapter}, but ${lost.predicate} it in chapter ${lost.validFromChapter} and has not got it back.`, [["earlier", lost]]);
        continue;
      }

      // Someone else has held it since before this chapter, and the user has not got it since.
      // A holding that starts in the use's own chapter may be its result (a hand-over), so it is left out.
      const other = holdings.find((h) => h.kind === "holds" && !mine(h.holder)
        && !(use.gives?.recipient && samePerson(h.holder, use.gives.recipient))
        && !GENERIC_ITEM.test(h.item) && sameItem(h.item, use.item)
        && h.fact.validFromChapter < chapter && validAt(h.fact, chapter)
        && !gotSince(h.fact.validFromChapter - 1));
      if (other) {
        add(`${use.user} ${verb} ${use.item} in chapter ${chapter}, but ${other.holder} holds it since chapter ${other.fact.validFromChapter}.`, [["holder", other.fact]]);
        continue;
      }

      // Giving away a tracked item the user never had.
      if (use.gives && gotAt.length === 0) {
        const usedBefore = uses.some((u) => u !== use && mine(u.user) && looseItem(u.item, use.item) && u.fact.validFromChapter < chapter);
        const tracked = holdings.find((h) => !mine(h.holder) && sameItem(h.item, use.item) && h.fact.validFromChapter < chapter);
        if (!usedBefore && tracked) {
          add(`${use.user} gives ${use.item} in chapter ${chapter}, but is never recorded with it; ${tracked.holder} had it in chapter ${tracked.fact.validFromChapter}.`, [["tracked", tracked.fact]]);
        }
      }
    }
    return [...findings.values()];
  },
};
