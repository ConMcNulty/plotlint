import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { hasKind } from "../predicates.js";
import { isDeathFact } from "./dead-entity-acts.js";
import { factFinding, firstOverlap, nested, normalize, normalizeValue, parseQuantity, validAt } from "./facts.js";
import { readHoldings } from "./item-from-nowhere.js";

// World rules are prose, so only three small, documented forms are read; any
// other world_rule fact is ignored. `subject · predicate · object`:
//
// 1. Use limits, on a world_rule fact: a count per period anywhere in "predicate object".
//      Eye of Dawn · can be used · at most once per day       (once/twice/thrice/N [times|uses|spells] per|a|each day|night|chapter)
//      magic · limit · three spells per night                 (a spell unit counts every cast)
//      Eye of Dawn · can be used · only once                  (once ever)
//      镇魂铃 · 使用限制 · 每天只能使用一次                     (每天/每日/每晚/每夜/每章 … N次, 只能使用一次)
//    A day or night is read as a chapter, so only uses in one chapter are counted together,
//    per user. A use is a fact whose predicate starts with the rule's verb ("can be cast" → cast)
//    or "use", and whose object names the rule's subject.
// 2. Maximums, labelled or not: a limit predicate and a number.
//      灵力 · 上限 · 100         mana · maximum · 100 points        mana · cannot exceed · 100
//      Lin · 灵力上限 · 100      Mira · max mana · 100              (scoped to that character)
//    Any later amount of that resource above the number breaks it.
// 3. Prohibitions, on a world_rule fact:
//      no one · can enter · the vault without the key        (no one/nobody/无人 · can/may/能 …)
//      dead · cannot · speak                                  (X · cannot/can't/may not/must not/不能/无法/不得 …)
//      vampires · cannot · cross running water                (X is a name, or a class read from identity facts)
//    The action's first word is the verb; the rest is what it is done to; "without Z"
//    excuses anyone holding Z; "unless"/"except" make the rule unreadable. A fact whose
//    predicate starts with the verb (any inflection) and names the target breaks it; "enter X"
//    is also broken by being located at X. For Chinese the action phrase must appear in
//    "predicate object" ("林远 · 进入 · 禁地" breaks "任何人 · 不得 · 进入禁地").

const MAX_CITED = 6;

const NUMBER_WORDS: Record<string, number> = {
  once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const countOf = (word: string) => NUMBER_WORDS[word] ?? parseQuantity(word)?.value ?? null;

// English inflections are folded to candidate base forms, so "used" meets "use" and "spoke" meets "speak".
const IRREGULAR: Record<string, string> = {
  spoke: "speak", spoken: "speak", said: "say", flew: "fly", flown: "fly", ate: "eat", eaten: "eat", went: "go", gone: "go",
  came: "come", saw: "see", seen: "see", ran: "run", wrote: "write", written: "write", drank: "drink", drunk: "drink",
  left: "leave", took: "take", taken: "take", gave: "give", given: "give", rode: "ride", swam: "swim", crept: "creep",
  fought: "fight", struck: "strike", stole: "steal", broke: "break", slept: "sleep", wept: "weep",
};
function baseForms(word: string): Set<string> {
  const w = word.toLowerCase();
  const forms = new Set([w]);
  if (IRREGULAR[w]) forms.add(IRREGULAR[w]!);
  if (/(ies|ied)$/u.test(w)) forms.add(`${w.slice(0, -3)}y`);
  if (w.endsWith("s")) forms.add(w.slice(0, -1));
  if (/(es|ed)$/u.test(w)) { forms.add(w.slice(0, -2)); forms.add(w.slice(0, -1)); }
  if (w.endsWith("ing") && w.length > 5) {
    const stem = w.slice(0, -3);
    forms.add(stem).add(`${stem}e`);
    if (/(.)\1$/u.test(stem)) forms.add(stem.slice(0, -1));
  }
  // "stopped", "planned": the doubled consonant.
  if (w.endsWith("ed") && /(.)\1ed$/u.test(w)) forms.add(w.slice(0, -3));
  return forms;
}
const sameVerb = (a: string, b: string) => {
  const forms = baseForms(a);
  return [...baseForms(b)].some((form) => forms.has(form));
};
const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
const hasHan = (text: string) => /\p{Script=Han}/u.test(text);

// Use limits.
type Period = "chapter" | "ever";
interface UseLimit {
  readonly type: "uses";
  readonly rule: CurrentStateFact;
  readonly target: string;
  readonly verb: string;
  /** Every cast counts, whatever it names ("three spells per night"). */
  readonly anySpell: boolean;
  readonly limit: number;
  readonly period: Period;
}

const PER_PERIOD = /\b(once|twice|thrice|(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(times?|uses?|charges?|casts?|spells?)?)\s+(?:per|a|an|each|every)\s+(day|night|evening|chapter)\b/u;
const ONCE_EVER = /\b(?:only|just)\s+once\b|\bonce\s+(?:ever|only|in a lifetime)\b|\bsingle use\b|\bone time only\b/u;
const CJK_PER_PERIOD = /每(?:天|日|晚|夜|章)[^次]{0,6}?([一二两三四五六七八九十\d]+)次/u;
const CJK_ONCE_EVER = /(?:只能|仅能|只可)(?:使用|用)?一次/u;
const SPELL = /\b(spells?|casts?)\b|法术|咒语|施法/u;
const CJK_USE = /(使用|动用|施展|施放|祭出|发动|催动)/u;

function parseUseLimit(rule: CurrentStateFact): UseLimit | null {
  const text = `${rule.predicate} ${rule.object}`.toLowerCase();
  let limit: number | null = null;
  let period: Period | null = null;
  let anySpell = false;
  const perPeriod = PER_PERIOD.exec(text);
  const cjk = CJK_PER_PERIOD.exec(text);
  if (perPeriod) {
    limit = countOf(perPeriod[2] ?? perPeriod[1]!);
    period = "chapter";
    anySpell = /spell|cast/u.test(perPeriod[3] ?? "");
  } else if (cjk) {
    limit = countOf(cjk[1]!);
    period = "chapter";
  } else if (ONCE_EVER.test(text) || CJK_ONCE_EVER.test(text)) {
    limit = 1;
    period = "ever";
  }
  if (limit === null || period === null || limit < 1) return null;
  // "can be cast", "may be opened": the verb of a use.
  const passive = /\b(?:can|may|could)\s+(?:only\s+)?be\s+(\p{L}+)/u.exec(text);
  const verb = passive ? passive[1]! : "use";
  return { type: "uses", rule, target: rule.subject, verb, anySpell: anySpell || (!passive && SPELL.test(rule.subject.toLowerCase())), limit, period };
}

function isUseOf(fact: CurrentStateFact, limit: UseLimit): boolean {
  if (hasHan(fact.predicate)) {
    if (!CJK_USE.test(fact.predicate)) return false;
    if (limit.anySpell) return true;
    return nested(normalizeValue(`${fact.predicate}${fact.object}`), normalizeValue(limit.target))
      && normalizeValue(fact.object) !== "";
  }
  const [first] = wordsOf(fact.predicate);
  if (!first) return false;
  if (limit.anySpell) return sameVerb(first, "cast") || /\bspells?\b/u.test(fact.predicate.toLowerCase());
  if (!sameVerb(first, limit.verb) && !sameVerb(first, "use")) return false;
  const target = normalizeValue(limit.target);
  return nested(normalizeValue(fact.object), target) && normalizeValue(fact.object) !== "";
}

// Maximums.
interface Maximum {
  readonly type: "max";
  readonly rule: CurrentStateFact;
  readonly resource: string;
  readonly max: number;
  /** The character the cap applies to, when the predicate names the resource ("Mira · max mana · 100"). */
  readonly scope: string | null;
}

const MAX_PREDICATES = new Set([
  "max", "maximum", "cap", "limit", "upperlimit", "maxvalue", "maximumvalue", "cannotexceed", "maynotexceed", "mustnotexceed",
  "neverexceeds", "上限", "最大值", "最高", "极限", "不能超过", "不得超过", "不可超过", "最多",
]);
const MAX_PREFIX = /^(?:max(?:imum)?|cap on|limit on)\s+(.+)$/iu;
const MAX_SUFFIX = /^(.+?)\s*(?:上限|最大值|cap|limit|maximum|max)$/iu;
const AT_MOST = /^(?:at most|no more than|up to|最多|至多|不超过)\s*/iu;
// Predicates that hold a change, a cost or a cap rather than a current amount.
const NOT_AN_AMOUNT = /(max|limit|cap|capacity|upper|change|delta|gain|spent|spend|cost|lost|loss|earned|regen|rate|\bper\b|上限|最大|最高|极限|容量|变化|消耗|花费|增加|减少|获得|恢复)/iu;
const CURRENT = /^(current|remaining|present|当前|剩余|现有)\s*|\s*(值|量)$/giu;

function parseMaximum(rule: CurrentStateFact): Maximum | null {
  const quantity = parseQuantity(rule.object.replace(AT_MOST, ""));
  if (!quantity || quantity.value < 0) return null;
  if (MAX_PREDICATES.has(normalize(rule.predicate))) {
    return { type: "max", rule, resource: rule.subject, max: quantity.value, scope: null };
  }
  const named = MAX_PREFIX.exec(rule.predicate.trim()) ?? MAX_SUFFIX.exec(rule.predicate.trim());
  return named ? { type: "max", rule, resource: named[1]!, max: quantity.value, scope: rule.subject } : null;
}

const sameResource = (a: string, b: string) => {
  const fold = (text: string) => normalizeValue(text.replace(CURRENT, "")).replace(/s$/u, "");
  return fold(a) !== "" && fold(a) === fold(b);
};

function amountOf(fact: CurrentStateFact, max: Maximum): number | null {
  if (NOT_AN_AMOUNT.test(fact.predicate)) return null;
  if (max.scope !== null && normalize(fact.subject) !== normalize(max.scope)) return null;
  const quantity = parseQuantity(fact.object);
  if (!quantity) return null;
  const named = sameResource(fact.predicate, max.resource) || (quantity.unit !== "" && sameResource(quantity.unit, max.resource));
  return named ? quantity.value : null;
}

// Prohibitions.
interface Prohibition {
  readonly type: "prohibition";
  readonly rule: CurrentStateFact;
  readonly who: { readonly kind: "everyone" | "dead" } | { readonly kind: "named"; readonly name: string };
  readonly verb: string | null;
  readonly target: string;
  /** Chinese: the whole action phrase. */
  readonly phrase: string | null;
  readonly without: string | null;
}

const NO_ONE = /^(no one|noone|nobody|none|无人|没有人|没人)$/iu;
const EVERYONE = /^(anyone|anybody|everyone|everybody|任何人|所有人|人人)$/iu;
const DEAD_CLASS = /^(the )?(dead|deceased|dead people|the dead|corpses|死者|死人|亡者)$/iu;
const CAN = /^(?:can|may|could|is able to|are able to|is allowed to|are allowed to|能|可以|可|能够)\s*(.*)$/iu;
const CANNOT = /^(?:cannot|can't|can not|may not|must not|mustn't|is unable to|are unable to|is not able to|are not able to|is not allowed to|are not allowed to|is forbidden to|are forbidden to|never)\s*(.*)$|^(?:不能|无法|不可以|不可|不得|禁止|不会)(.*)$/iu;
// Verbs too vague to hold a rule to.
const VAGUE_VERBS = new Set(["be", "is", "are", "have", "has", "get", "do", "make"]);
// A fact that says the thing did not (or may not) happen.
const NEGATED = /\b(not|never|cannot|can't|unable|fail|fails|failed|tries|tried|try|attempts|attempted|wants|plans|refuses|refused)\b|不|没|未|无法|试图|想要|打算/iu;

function parseProhibition(rule: CurrentStateFact): Prohibition | null {
  const subject = rule.subject.trim();
  const predicate = rule.predicate.trim();
  let who: Prohibition["who"];
  let action: string;
  const can = CAN.exec(predicate);
  const cannot = CANNOT.exec(predicate);
  // "没有钥匙的人 · 不能 · 进入宝库": the subject is everyone without the thing.
  const cjkWithout = /^(?:没有|无|不带)(.+?)(?:的人|者)$/u.exec(subject);
  if (NO_ONE.test(subject) && can) {
    who = { kind: "everyone" };
    action = `${can[1]} ${rule.object}`;
  } else if (cannot) {
    who = EVERYONE.test(subject) || cjkWithout ? { kind: "everyone" } : DEAD_CLASS.test(subject) ? { kind: "dead" } : { kind: "named", name: subject };
    action = `${cannot[1] ?? cannot[2] ?? ""} ${rule.object}`;
  } else {
    return null;
  }
  action = action.trim();
  if (!action || /\b(unless|except)\b|除非|除了/iu.test(action)) return null;

  if (hasHan(action)) {
    return { type: "prohibition", rule, who, verb: null, target: "", phrase: normalizeValue(action), without: cjkWithout ? cjkWithout[1]! : null };
  }
  const [main, without] = action.split(/\s+without\s+/iu);
  const [verb, ...rest] = wordsOf(main!);
  if (!verb || VAGUE_VERBS.has(verb)) return null;
  return { type: "prohibition", rule, who, verb, target: rest.join(" "), phrase: null, without: without ?? null };
}

/** Whether `fact` names the subject as a member of a class ("Count · species · vampire" for "vampires"). */
function memberOf(facts: ReadonlyArray<CurrentStateFact>, entity: string, name: string, chapter: number): boolean {
  const fold = (text: string) => normalizeValue(text).replace(/s$/u, "");
  if (fold(entity) === fold(name)) return true;
  return facts.some((f) => normalize(f.subject) === normalize(entity)
    && (hasKind(f, "identity") || ["is", "was", "isa", "是"].includes(normalize(f.predicate)))
    && fold(f.object) === fold(name) && validAt(f, chapter));
}

function breaks(fact: CurrentStateFact, rule: Prohibition, facts: ReadonlyArray<CurrentStateFact>): boolean {
  const chapter = fact.validFromChapter;
  if (NEGATED.test(fact.predicate)) return false;
  if (rule.who.kind === "dead") {
    if (isDeathFact(fact) || !facts.some((f) => isDeathFact(f) && normalize(f.subject) === normalize(fact.subject)
      && f.validFromChapter < chapter && validAt(f, chapter))) return false;
  } else if (rule.who.kind === "named" && !memberOf(facts, fact.subject, rule.who.name, chapter)) {
    return false;
  }

  let acts: boolean;
  if (rule.phrase !== null) {
    acts = normalizeValue(`${fact.predicate}${fact.object}`).includes(rule.phrase);
    const entry = /^(?:进入|进)(.+)$/u.exec(rule.phrase);
    if (!acts && entry && hasKind(fact, "location")) acts = normalizeValue(fact.object) === entry[1];
  } else {
    const [first, ...rest] = wordsOf(fact.predicate);
    const target = normalizeValue(rule.target);
    acts = !!first && sameVerb(first, rule.verb!)
      && (target === "" || nested(normalizeValue(`${rest.join(" ")} ${fact.object}`), target));
    if (!acts && rule.verb === "enter" && target !== "" && hasKind(fact, "location")) acts = normalizeValue(fact.object) === target;
  }
  if (!acts) return false;

  if (rule.without) {
    const tool = normalizeValue(rule.without);
    if (normalizeValue(`${fact.predicate}${fact.object}`).includes(tool)) return false;
    const holds = facts.flatMap(readHoldings).some((h) => normalize(h.holder) === normalize(fact.subject)
      && nested(normalizeValue(h.item), tool) && h.fact.validFromChapter <= chapter
      && (h.kind === "acquires" || validAt(h.fact, chapter)));
    if (holds) return false;
  }
  return true;
}

const isRuleFact = (fact: CurrentStateFact) => hasKind(fact, "world_rule");

export const worldRuleBroken: Rule = {
  id: "continuity/world-rule-broken",
  layer: "continuity",
  title: "World rule broken",
  rationale: "Stated costs and limits of a magic or tech system should apply to every later use. A use beyond the stated limit, a resource above its stated maximum or a forbidden act undermines the stakes the rule set up, unless the story shows why it is an exception.",
  source: "Brandon Sanderson, \"Sanderson's Second Law\" (limitations are more interesting than powers), 2012",
  check({ snapshot }) {
    const facts = snapshot.currentState.facts;
    const diagnostics: Diagnostic[] = [];
    const candidates = facts.filter((fact) => !isRuleFact(fact));
    const label = (rule: CurrentStateFact) => `${rule.subject} · ${rule.predicate} · ${rule.object}`;

    for (const rule of facts) {
      // A rule superseded in the chapter that stated it was never in force.
      if (rule.validUntilChapter !== null && rule.validUntilChapter < rule.validFromChapter) continue;
      const labelled = isRuleFact(rule);

      const uses = labelled ? parseUseLimit(rule) : null;
      if (uses) {
        const counted = candidates.filter((fact) => fact !== rule && fact.validFromChapter >= rule.validFromChapter
          && validAt(rule, fact.validFromChapter) && isUseOf(fact, uses));
        const groups = new Map<string, CurrentStateFact[]>();
        for (const fact of counted) {
          const key = uses.period === "chapter" ? `${normalize(fact.subject)}\u0000${fact.validFromChapter}` : normalize(fact.subject);
          groups.set(key, [...(groups.get(key) ?? []), fact]);
        }
        for (const group of groups.values()) {
          if (group.length <= uses.limit) continue;
          group.sort((a, b) => a.validFromChapter - b.validFromChapter);
          const chapter = group[uses.limit]!.validFromChapter;
          diagnostics.push(factFinding(this, {
            chapter,
            summary: uses.period === "chapter"
              ? `${group[0]!.subject} uses ${uses.anySpell ? "spells" : uses.target} ${group.length} times in chapter ${chapter}, but the world rule allows ${uses.limit}: "${label(rule)}".`
              : `${group[0]!.subject} uses ${uses.target} ${group.length} times, but the world rule allows it once: "${label(rule)}".`,
            evidence: [["rule", rule], ...group.slice(0, MAX_CITED).map((fact) => ["use", fact] as const)],
          }));
        }
        continue;
      }

      const max = parseMaximum(rule);
      if (max) {
        for (const fact of candidates) {
          if (fact === rule || parseMaximum(fact)) continue;
          const amount = amountOf(fact, max);
          const chapter = amount !== null && amount > max.max ? firstOverlap(rule, fact) : null;
          if (chapter === null) continue;
          diagnostics.push(factFinding(this, {
            chapter,
            summary: `${fact.subject}'s ${fact.predicate} is ${fact.object} in chapter ${chapter}, above the stated maximum of ${max.max}: "${label(rule)}".`,
            evidence: [["rule", rule], ["above", fact]],
          }));
        }
        continue;
      }

      const prohibition = labelled ? parseProhibition(rule) : null;
      if (!prohibition) continue;
      for (const fact of candidates) {
        if (fact === rule || fact.validFromChapter < rule.validFromChapter || !validAt(rule, fact.validFromChapter)
          || (fact.validUntilChapter !== null && fact.validUntilChapter < fact.validFromChapter)
          || !breaks(fact, prohibition, facts)) continue;
        diagnostics.push(factFinding(this, {
          chapter: fact.validFromChapter,
          summary: `${fact.subject} ${fact.predicate} ${fact.object} in chapter ${fact.validFromChapter}, which the world rule forbids: "${label(rule)}".`,
          evidence: [["rule", rule], ["breaks it", fact]],
        }));
      }
    }
    return diagnostics;
  },
};
