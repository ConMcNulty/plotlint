import type { CurrentStateFact, RuntimeStateSnapshot } from "@actalk/inkos-core";
import { hasKind, HOLDER_FIRST, ITEM_FIRST, namesResource } from "../../predicates.js";
import { normalize, normalizeValue, parseQuantity } from "../facts.js";
import { splitItems } from "../item-from-nowhere.js";

// The things a fact talks about (characters, places, objects), and how to tell
// whether a later fact, summary or chapter text mentions one again. Structural
// rules use these to follow a setup forward: a term "returns" when it is named
// again later. Matching errs towards finding a mention, so the rules built on it
// stay quiet unless something really is never named again.

const ARTICLE = /^(the|a|an|his|her|their|its|my|your|our)\s+/iu;
const PARENTHETICAL = /\s*[（(][^)）]*[)）]\s*/gu;
// Counted or indefinite things ("two arrows", "一把剑") name a kind, not one object.
const GENERIC = /^(a|an|some|any|several|many|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s|^[一两二三四五六七八九十几数]+[把个件枚只支张块本柄根颗套份些]|^\d/iu;
// Values that are states, not things: "dead", "true", "gravely ill".
const STATE_VALUE = /^(yes|no|true|false|none|unknown|alive|dead|living|injured|wounded|missing|ill|sick|gravely ill|opened|closed|open|locked|unlocked|broken|sunk|lost|found|是|否|无|未知|活着|死亡|已死|受伤|失踪)$/iu;
const PROPER_NAME = /\p{Lu}[\p{Ll}'’-]+(?:\s+(?:of\s+|the\s+|de\s+|van\s+)?\p{Lu}[\p{Ll}'’-]+)*/gu;
const HEAD_CUT = /\s+(?:of|from|in|with|for|on|at|under|inside|containing|to|by)\s+.*$/iu;

/** A term as compared: no article or possessive pronoun, no parenthetical. */
export const cleanTerm = (raw: string) => raw.replace(PARENTHETICAL, " ").trim().replace(ARTICLE, "").trim();

const wordCount = (text: string) => text.split(/\s+/u).filter(Boolean).length;
const isCjk = (text: string) => /\p{Script=Han}/u.test(text);

/** Whether a fact's value names one thing worth following: not a count, a state, a resource or a whole clause. */
export function isTermLike(raw: string): boolean {
  const term = cleanTerm(raw);
  if (!term || GENERIC.test(term) || STATE_VALUE.test(term) || parseQuantity(term) !== null) return false;
  if (namesResource(term) && !/\p{Lu}/u.test(term.slice(1))) return false;
  if (isCjk(term)) return term.length >= 2 && term.length <= 12;
  return wordCount(term) <= 6 && /\p{L}{3}/u.test(term);
}

/**
 * Whether two terms name the same thing: equal once compared, or one inside the
 * other when the shorter is specific enough (two words, a capitalised name of four
 * letters or more, or three CJK characters), so "key" is not "brass key" but
 * "Crane" is "Absalom Crane".
 */
export function sameTerm(a: string, b: string): boolean {
  const ca = cleanTerm(a);
  const cb = cleanTerm(b);
  const na = normalizeValue(ca);
  const nb = normalizeValue(cb);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (!(na.includes(nb) || nb.includes(na))) return false;
  const shorter = na.length <= nb.length ? ca : cb;
  if (isCjk(shorter)) return normalizeValue(shorter).length >= 3;
  if (wordCount(shorter) >= 2) return true;
  return /^\p{Lu}/u.test(shorter) && shorter.length >= 4 && wordBoundaryIn(shorter, na.length <= nb.length ? cb : ca);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// Whole-word patterns, compiled once per phrase: the dependency graph tests each
// term against every later chapter.
const patterns = new Map<string, RegExp>();

function wordBoundaryIn(needle: string, haystack: string): boolean {
  let pattern = patterns.get(needle);
  if (!pattern) {
    if (patterns.size > 5000) patterns.clear();
    patterns.set(needle, pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(needle).replace(/\s+/gu, "\\s+")}(?![\\p{L}\\p{N}])`, "iu"));
  }
  return pattern.test(haystack);
}

/**
 * The phrases that count as naming a term in prose: the term itself, without a
 * possessor ("father's compass" → "compass"), the proper names inside it, and for
 * objects the head noun ("letter from father" → "letter").
 */
export function textPhrases(raw: string, item = false): string[] {
  const term = cleanTerm(raw);
  const phrases = new Set<string>([term]);
  if (isCjk(term)) return [...phrases];
  const unowned = term.replace(/^[\p{L}\s.-]+?['’]s\s+/u, "");
  phrases.add(unowned);
  for (const name of term.match(PROPER_NAME) ?? []) if (name.length >= 4) phrases.add(name);
  if (item) {
    const head = unowned.replace(HEAD_CUT, "").split(/\s+/u).pop();
    if (head && head.length >= 3) phrases.add(head);
  }
  return [...phrases].filter((phrase) => phrase.length >= 3);
}

/** Whether `text` names any of the phrases as whole words (CJK: as a substring). Case does not matter. */
export function mentionsAny(text: string, phrases: ReadonlyArray<string>): boolean {
  return phrases.some((phrase) => (isCjk(phrase) ? text.includes(phrase) : wordBoundaryIn(phrase, text)));
}

const CHARACTER_KINDS = ["age", "goal", "knowledge", "relationship"] as const;

/**
 * Entities that act: subjects with an age, goal, knowledge, relationship or
 * action fact (objects have locations and states too, so those do not count),
 * and the names in chapter summaries' character lists.
 */
export function characterNames(snapshot: RuntimeStateSnapshot): Set<string> {
  const names = new Set<string>();
  for (const fact of snapshot.currentState.facts) {
    if (CHARACTER_KINDS.some((kind) => hasKind(fact, kind)) || /^(action|actions|did|does|行动|动作)$/u.test(normalize(fact.predicate))) {
      names.add(normalize(fact.subject));
    }
  }
  for (const row of snapshot.chapterSummaries.rows) {
    for (const name of row.characters.split(/[,，、;；]/u)) {
      const clean = cleanTerm(name.replace(PARENTHETICAL, " "));
      if (clean) names.add(normalize(clean));
    }
  }
  return names;
}

const POSSESSION_WORDS = new Set(["possession", "possessions", "possesses", "has", "have", "inventory", "item", "items", "belongings", "carries", "持有物", "物品"]);

/**
 * The objects a possession fact is about. Holder-first and item-first predicates
 * are read as the continuity rules read them; a bare "possession" fact names its
 * item first unless its subject is a character ("ferry ledger · possession · Thorne").
 */
export function factItems(fact: CurrentStateFact, characters: ReadonlySet<string>): string[] {
  const predicate = normalize(fact.predicate);
  let items: string[];
  if (HOLDER_FIRST[predicate]) items = splitItems(fact.object);
  else if (ITEM_FIRST[predicate]) items = [fact.subject];
  else if (hasKind(fact, "possession") || POSSESSION_WORDS.has(predicate)) {
    items = characters.has(normalize(fact.subject)) ? splitItems(fact.object) : [fact.subject];
  } else {
    return [];
  }
  return items.filter((item) => isTermLike(item) && !characters.has(normalize(cleanTerm(item))));
}

/** Every term a fact names: its subject, its items, and its value when that names a thing. */
export function factTerms(fact: CurrentStateFact, characters: ReadonlySet<string>): string[] {
  const terms = new Set<string>();
  if (isTermLike(fact.subject)) terms.add(cleanTerm(fact.subject));
  const items = factItems(fact, characters);
  for (const item of items) terms.add(cleanTerm(item));
  if (items.length === 0 && !hasKind(fact, "resource") && !hasKind(fact, "age") && !hasKind(fact, "time")) {
    for (const part of splitItems(fact.object)) if (isTermLike(part)) terms.add(cleanTerm(part));
  }
  return [...terms];
}
