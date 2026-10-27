import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";

// Helpers shared by the rules over InkOS's temporal subject-predicate-object facts.

/** Compare keys: case, whitespace, `_` and `-` do not matter ("Current Location" = "current_location"). */
export const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/gu, "");

export function validAt(fact: CurrentStateFact, chapter: number): boolean {
  // InkOS treats validUntilChapter as inclusive.
  return fact.validFromChapter <= chapter && (fact.validUntilChapter === null || fact.validUntilChapter >= chapter);
}

/**
 * The first chapter in which both facts are valid, or null when their validity
 * never overlaps. A fact superseded in the chapter that added it (until < from)
 * is never valid, so it never overlaps.
 */
export function firstOverlap(a: CurrentStateFact, b: CurrentStateFact): number | null {
  const from = Math.max(a.validFromChapter, b.validFromChapter);
  const until = Math.min(a.validUntilChapter ?? Infinity, b.validUntilChapter ?? Infinity);
  return from <= until ? from : null;
}

export const renderFact = (fact: CurrentStateFact) =>
  `${fact.subject} · ${fact.predicate} · ${fact.object} (from ch${fact.validFromChapter}, recorded in ch${fact.sourceChapter})`;

/**
 * A comparable form of a free-text value such as a place or item: lowercased,
 * without punctuation, spaces or a leading English article ("The Harbour" = "harbour").
 */
export function normalizeValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/u, "")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

/** True when one normalized value contains the other, e.g. "harbour" in "harbourdocks" or "城门" in "京城城门". */
export const nested = (a: string, b: string) => a.includes(b) || b.includes(a);

/** Visit each unordered pair of facts that are valid in a common chapter, with that first chapter. */
export function forEachOverlappingPair(
  facts: ReadonlyArray<CurrentStateFact>,
  visit: (a: CurrentStateFact, b: CurrentStateFact, chapter: number) => void,
): void {
  for (let i = 0; i < facts.length; i += 1) {
    for (let j = i + 1; j < facts.length; j += 1) {
      const chapter = firstOverlap(facts[i]!, facts[j]!);
      if (chapter !== null) visit(facts[i]!, facts[j]!, chapter);
    }
  }
}

/** Group facts by a key; facts for which `key` returns null are left out. */
export function groupBy<T>(items: ReadonlyArray<T>, key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k !== null) groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

export interface FactFindingInput {
  readonly chapter: number;
  readonly summary: string;
  /** Evidence lines, each pairing a label with the fact it rests on. */
  readonly evidence: ReadonlyArray<readonly [label: string, fact: CurrentStateFact]>;
  readonly severity?: Diagnostic["severity"];
}

/** A continuity warning over extracted facts, citing each fact as evidence and as a fact ref. */
export function factFinding(rule: Pick<Rule, "id" | "layer">, input: FactFindingInput): Diagnostic {
  return {
    code: rule.id.split("/").pop() ?? rule.id,
    ruleId: rule.id,
    layer: rule.layer,
    severity: input.severity ?? "warning",
    confidence: "extracted",
    category: "quality",
    assessment: "issue",
    chapter: input.chapter,
    summary: input.summary,
    evidence: input.evidence.map(([label, fact]) => `${label}: ${renderFact(fact)}`),
    facts: input.evidence.map(([, fact]) => ({ ...fact })),
  };
}

const CHINESE_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CHINESE_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const CHINESE_SECTIONS: Record<string, number> = { 万: 1e4, 亿: 1e8 };

function parseChineseNumeral(text: string): number | null {
  let total = 0;
  let section = 0;
  let digit: number | null = null;
  for (const char of text) {
    if (char in CHINESE_DIGITS) {
      if (digit !== null) return null; // "三五" is not a numeral we read
      digit = CHINESE_DIGITS[char]!;
    } else if (char in CHINESE_UNITS) {
      section += (digit ?? 1) * CHINESE_UNITS[char]!;
      digit = null;
    } else if (char in CHINESE_SECTIONS) {
      total += (section + (digit ?? 0)) * CHINESE_SECTIONS[char]!;
      section = 0;
      digit = null;
    } else {
      return null;
    }
  }
  return total + section + (digit ?? 0);
}

export interface ParsedQuantity {
  readonly value: number;
  /** Whatever follows the number, e.g. "gold", "枚灵石", "岁"; empty when there is none. */
  readonly unit: string;
}

const ARABIC = /^([-−–+]|minus\s+|负)?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*([\p{L}][\p{L}\s.']{0,23})?$/iu;
const CHINESE = /^(负)?([零〇一二两三四五六七八九十百千万亿]+)([\p{L}]{0,8})$/u;

// English number words up to ninety-nine ("seventeen", "twenty-one"), as settlers copy them from prose.
const ENGLISH_UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const ENGLISH_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ENGLISH = new RegExp(
  `^(minus\\s+)?(?:(${ENGLISH_TENS.filter(Boolean).join("|")})(?:[-\\s](${ENGLISH_UNITS.slice(1, 10).join("|")}))?|(${ENGLISH_UNITS.join("|")}))\\b\\s*([\\p{L}][\\p{L}\\s.']{0,23})?$`,
  "iu",
);

/**
 * Read a value like "-1,200 gold", "−5", "minus 3 arrows", "seventeen", "负50灵石" or "负三十枚金币"
 * as a number with an optional unit. Anything else (ranges, prose, "about 5") is null.
 */
export function parseQuantity(raw: string): ParsedQuantity | null {
  const text = raw.trim();
  const arabic = ARABIC.exec(text);
  if (arabic) {
    const sign = arabic[1] && arabic[1] !== "+" ? -1 : 1;
    const value = Number(`${arabic[2]!.replace(/,/gu, "")}${arabic[3] ?? ""}`);
    return { value: sign * value, unit: (arabic[4] ?? "").trim() };
  }
  const english = ENGLISH.exec(text);
  if (english) {
    const value = english[4] !== undefined
      ? ENGLISH_UNITS.indexOf(english[4].toLowerCase())
      : ENGLISH_TENS.indexOf(english[2]!.toLowerCase()) * 10 + (english[3] ? ENGLISH_UNITS.indexOf(english[3].toLowerCase()) : 0);
    return { value: english[1] ? -value : value, unit: (english[5] ?? "").trim() };
  }
  const chinese = CHINESE.exec(text);
  if (chinese) {
    let numeral = chinese[2]!;
    let unit = chinese[3]!;
    // 两 is also a unit of silver ("三十两"): read a trailing 两 after 十/百 as the unit.
    if (/[十百]两$/u.test(numeral)) {
      numeral = numeral.slice(0, -1);
      unit = `两${unit}`;
    }
    const value = parseChineseNumeral(numeral);
    if (value === null) return null;
    return { value: chinese[1] ? -value : value, unit };
  }
  return null;
}
