import type { CurrentStateFact, FactKind } from "@actalk/inkos-core";
import { normalize } from "./rules/facts.js";

// Typed predicates: the settler labels new facts with a kind; older facts are
// classified from their predicate name. This file is the one vocabulary of
// predicate names, in English and Chinese, compared after `normalize` (case,
// spaces, `_` and `-` do not matter). The rules match a fact when either the
// settler's label or its predicate name says the kind, so a label widens what a
// rule sees and never hides a fact the vocabulary already recognises.

// Alive, dead, injured. Death itself is read from the object (see dead-entity-acts).
export const STATUS_PREDICATES = new Set([
  "status", "state", "condition", "alive", "lifestatus", "life", "vitalstatus", "health",
  "状态", "生死", "生死状态", "存活", "存活状态", "生命状态",
]);

// Predicates that put the subject somewhere. Words that also name a state or a
// role are left out: "in"/"is in" ("in love"), "at", "position" (a job), "place"
// (a ranking), "在" and "处于" ("处于昏迷").
export const LOCATION_PREDICATES = new Set([
  "location", "currentlocation", "whereabouts", "currentplace", "locatedat", "locatedin", "staysat", "stayingat",
  "位置", "当前位置", "所在", "所在地", "所在位置", "所在地点", "地点", "当前地点", "当前所在", "位于", "身处", "现处",
]);

export const AGE_PREDICATES = new Set(["age", "currentage", "年龄", "年纪", "岁数", "当前年龄"]);

// Possession is directional: "Mira · holds · brass key" names the holder first,
// "brass key · held by · Mira" the item. Holding (who has the thing on them) and
// owning (whose it is) are different relations: a thief holds what the merchant owns.
//
// Bare "has"/"have"/"有" are left out: settlers use them for traits, relatives
// and conditions ("has a fever", "has a sister"), which many characters share.
// "belongs to"/"属于" are left out too: they mostly record membership of a group.
// So are "keeps", "possesses" and "wields", which settlers also use for abstract
// things ("keeps a secret", "possesses magic") that many characters share.
export type PossessionRelation = "holds" | "owns";

export const HOLDER_FIRST: Readonly<Record<string, PossessionRelation>> = Object.fromEntries([
  ...["holds", "holding", "carries", "carrying", "inpossessionof", "hasinhand",
    "持有", "携带", "手持", "拿着", "握着", "随身携带", "身上带着", "怀揣"].map((p) => [p, "holds" as const]),
  ...["owns", "ownerof", "拥有"].map((p) => [p, "owns" as const]),
]);

export const ITEM_FIRST: Readonly<Record<string, PossessionRelation>> = Object.fromEntries([
  ...["heldby", "carriedby", "possessedby", "holder", "currentholder", "bearer", "inthepossessionof",
    "持有者", "持有人", "携带者", "持有方"].map((p) => [p, "holds" as const]),
  ...["owner", "ownedby", "currentowner", "所有者", "所有人", "主人", "物主"].map((p) => [p, "owns" as const]),
]);

// Tracked resources, matched against whole English words of a predicate or a
// unit ("gold", "spirit stones", "HP") so short words don't hit inside others
// ("mp" in "camp"), and as substrings of Chinese text.
const RESOURCE_WORDS = new Set([
  "money", "gold", "silver", "copper", "coin", "cash", "fund", "saving", "wealth", "credit", "dollar", "crown", "ducat",
  "mana", "mp", "hp", "hitpoint", "healthpoint", "stamina", "qi", "ammo", "ammunition", "bullet", "arrow", "round",
  "ration", "supply", "provision", "fuel", "potion", "gem", "crystal", "spiritstone", "xp", "exp", "experience", "life", "live",
]);
const RESOURCE_CJK = /(钱|银两|银子|金子|金币|银币|铜币|铜钱|铜板|灵石|元石|晶石|仙玉|法力|灵力|真气|内力|魔力|体力|生命值|血量|气血|弹药|子弹|箭矢|积分|贡献点|经验|资金|存款|粮食|丹药|寿元)/u;

// Crude plural folding, enough for "coins", "arrows", "supplies", "hit points".
const singular = (word: string) =>
  word.length > 3 && word.endsWith("ies") ? `${word.slice(0, -3)}y`
  : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1)
  : word;

/** True when a predicate or unit names a tracked resource ("gold", "spirit stones", "灵石"). */
export function namesResource(text: string): boolean {
  if (RESOURCE_CJK.test(text)) return true;
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).map(singular);
  // Single words and adjacent pairs ("spirit stones", "hit points").
  return words.some((word, i) => RESOURCE_WORDS.has(word) || (i + 1 < words.length && RESOURCE_WORDS.has(word + words[i + 1])));
}

// The kinds no rule checks yet, recognised so state views can group facts.
// Words that are already in a vocabulary above (e.g. "主人", an owner) are not repeated.
const KNOWLEDGE_PREDICATES = new Set([
  "knows", "knowsabout", "knowledge", "aware", "awareof", "isawareof", "believes", "belief", "suspects",
  "learned", "learnt", "discovered", "remembers", "hasseen", "witnessed",
  "知道", "得知", "知晓", "知情", "了解", "认为", "相信", "怀疑", "发现", "记得", "目睹", "听说",
]);

const RELATIONSHIP_PREDICATES = new Set([
  "relationship", "relation", "relationto", "relationshipwith", "attitudetoward", "attitudetowards", "feelingstoward",
  "ally", "allyof", "alliedwith", "enemy", "enemyof", "friend", "friendof", "rival", "rivalof", "lover", "loverof",
  "spouse", "marriedto", "husband", "wife", "fiance", "fiancee", "parent", "parentof", "father", "fatherof",
  "mother", "motherof", "child", "childof", "son", "sonof", "daughter", "daughterof", "sibling", "siblingof",
  "brother", "sister", "mentor", "mentorof", "master", "masterof", "disciple", "discipleof", "student", "studentof",
  "apprentice", "apprenticeof", "servant", "servantof", "serves", "loyalto", "loves", "hates", "trusts", "distrusts",
  "关系", "人际关系", "态度", "盟友", "敌人", "仇人", "朋友", "好友", "对手", "恋人", "爱人", "配偶", "妻子", "丈夫",
  "未婚妻", "未婚夫", "父亲", "母亲", "儿子", "女儿", "兄弟", "姐妹", "师父", "师傅", "师尊", "徒弟", "弟子",
  "效忠", "爱慕", "喜欢", "憎恨", "信任",
]);

const IDENTITY_PREDICATES = new Set([
  "identity", "trueidentity", "secretidentity", "name", "fullname", "realname", "truename", "alias", "aka", "nickname",
  "title", "role", "occupation", "job", "profession", "rank", "species", "race", "gender", "sex",
  "faction", "affiliation", "memberof", "sect", "clan", "nationality", "origin", "birthplace", "hometown",
  "身份", "真实身份", "名字", "姓名", "本名", "真名", "化名", "别名", "外号", "绰号", "称号", "头衔", "职业", "职位",
  "官职", "种族", "性别", "门派", "宗门", "所属", "所属势力", "势力", "阵营", "出身", "籍贯", "家乡",
]);

const TRAIT_PREDICATES = new Set([
  "trait", "traits", "appearance", "looks", "height", "weight", "hair", "haircolor", "eyes", "eyecolor", "build",
  "personality", "temperament", "skill", "skills", "ability", "abilities", "power", "powers", "talent", "strength",
  "weakness", "cultivation", "cultivationlevel", "realm", "bloodline", "physique",
  "特征", "外貌", "长相", "相貌", "身高", "体重", "发色", "瞳色", "性格", "脾气", "技能", "能力", "天赋", "特长",
  "功法", "修为", "境界", "实力", "弱点", "血脉", "体质",
]);

const GOAL_PREDICATES = new Set([
  "goal", "goals", "aim", "objective", "intent", "intention", "intends", "intendsto", "plan", "plans", "plansto",
  "wants", "wantsto", "desire", "desires", "mission", "quest", "motive", "motivation", "ambition", "purpose", "seeks",
  "目标", "目的", "意图", "打算", "计划", "想要", "愿望", "心愿", "任务", "使命", "动机", "野心", "追求",
]);

const WORLD_RULE_PREDICATES = new Set([
  "rule", "worldrule", "law", "magicrule", "cost", "limit", "limitation", "constraint", "requires", "requirement",
  "taboo", "prohibition",
  "规则", "法则", "规矩", "禁忌", "限制", "代价", "天道", "戒律", "门规",
]);

const TIME_PREDICATES = new Set([
  "time", "date", "currentdate", "currenttime", "timeofday", "day", "season", "year", "era", "elapsedtime",
  "timeelapsed", "deadline",
  "时间", "日期", "当前时间", "时辰", "季节", "年份", "年代", "纪元", "天数", "期限",
]);

// Checked in this order, so a name in two lists ("life": status and a resource word) takes the first.
const EXACT: ReadonlyArray<readonly [FactKind, ReadonlySet<string>]> = [
  ["status", STATUS_PREDICATES],
  ["location", LOCATION_PREDICATES],
  ["age", AGE_PREDICATES],
  ["possession", new Set([...Object.keys(HOLDER_FIRST), ...Object.keys(ITEM_FIRST)])],
  ["knowledge", KNOWLEDGE_PREDICATES],
  ["relationship", RELATIONSHIP_PREDICATES],
  ["identity", IDENTITY_PREDICATES],
  ["trait", TRAIT_PREDICATES],
  ["goal", GOAL_PREDICATES],
  ["world_rule", WORLD_RULE_PREDICATES],
  ["time", TIME_PREDICATES],
];
const EXACT_BY_KIND = new Map(EXACT);

/** The kind of state a predicate name records, or "other" when the name is not in the vocabulary. */
export function classifyPredicate(predicate: string): FactKind {
  const key = normalize(predicate);
  for (const [kind, names] of EXACT) if (names.has(key)) return kind;
  // Resources are named inside longer predicates ("gold coins", "剩余灵石").
  if (namesResource(predicate)) return "resource";
  return "other";
}

/** A fact's kind: the settler's label when it gave one, else classified from the predicate. */
export const factKind = (fact: CurrentStateFact): FactKind => fact.kind ?? classifyPredicate(fact.predicate);

/**
 * Whether a fact records `kind`, by the settler's label or by its predicate name.
 * Rules use this rather than `factKind` so that a label adds facts with unusual
 * predicate names without dropping ones the vocabulary already knows.
 */
export function hasKind(fact: CurrentStateFact, kind: FactKind): boolean {
  if (fact.kind === kind) return true;
  if (kind === "resource") return namesResource(fact.predicate);
  return EXACT_BY_KIND.get(kind)?.has(normalize(fact.predicate)) ?? false;
}
