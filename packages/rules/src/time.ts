import type { CurrentStateFact } from "@actalk/inkos-core";
import { hasKind } from "./predicates.js";
import { normalize, normalizeValue, parseQuantity } from "./rules/facts.js";

// Time markers: what a time fact's object says about when a scene happens. The
// settler writes them as free text ("12 March 1891", "three days later",
// "the next morning", "二十年前", "三天后", "born 1860"), so this module reads the
// common shapes into numbers the rules can compare and returns null for anything
// hedged, ranged or unfamiliar: a misread date is a false alarm, a skipped one
// is only a missed check. Fictional calendars ("the 3rd of Frostmonth") are not
// read at all, except for plain "year 412". Browser-safe: no Node imports.

export type Season = "spring" | "summer" | "autumn" | "winter";
export type PartOfDay = "dawn" | "morning" | "noon" | "afternoon" | "evening" | "night" | "midnight";
export type Hemisphere = "north" | "south";

/** Time that passes before (later) or lies behind (earlier) the scene that states it. */
export interface Elapsed {
  readonly direction: "later" | "earlier";
  /** The plain reading: "three days later" is 72 hours. */
  readonly hours: number;
  /** The most it can mean: "three days later" is under 4 days, "years later" is unbounded (Infinity). */
  readonly maxHours: number;
}

/** What one time expression says. Every field is optional; a reading has at least one. */
export interface TimeReading {
  /** Calendar year; negative for BC. */
  readonly year?: number;
  /** 1–12. */
  readonly month?: number;
  readonly day?: number;
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekday?: number;
  readonly season?: Season;
  readonly partOfDay?: PartOfDay;
  /** 0–23. */
  readonly hour?: number;
  readonly elapsed?: Elapsed;
  /** "age 30", "30 years old", "三十岁". */
  readonly age?: number;
  /** "born 1860", "生于1860年". */
  readonly birthYear?: number;
}

export const HOUR = 1;
export const DAY = 24;
export const WEEK = 7 * DAY;
export const YEAR = 365.25 * DAY;
export const MONTH = YEAR / 12;

// ---------------------------------------------------------------------------
// Vocabulary

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_WORD = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?";
// Standing alone, only full names that are not also common words: "may" is a verb, "mar" and "dec" are abbreviations.
const LONE_MONTH = /\b(january|february|march|april|june|july|august|september|october|november|december)\b/u;

const WEEKDAYS: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const CN_WEEKDAYS: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const VAGUE_COUNT = /^(a few|few|several|some|many|a couple of|a couple|couple of|countless|numerous)$/u;

const EN_UNITS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(second|moment|instant)s?$/u, 1 / 60],
  [/^minutes?$/u, 1 / 60],
  [/^hours?$/u, HOUR],
  [/^(day|night)s?$/u, DAY],
  [/^weeks?$/u, WEEK],
  [/^fortnights?$/u, 2 * WEEK],
  [/^months?$/u, MONTH],
  [/^seasons?$/u, 3 * MONTH],
  [/^years?$/u, YEAR],
  [/^decades?$/u, 10 * YEAR],
  [/^centur(y|ies)$/u, 100 * YEAR],
];
const EN_UNIT = "(seconds?|moments?|instants?|minutes?|hours?|days?|nights?|weeks?|fortnights?|months?|seasons?|years?|decades?|centur(?:y|ies))";
const EN_COUNT = "(\\d+(?:\\.\\d+)?|a few|a couple of|a couple|half an?|several|some|many|few|[a-z]+(?:-[a-z]+)?)";

const CN_UNITS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(秒钟?|分钟?|片刻)$/u, 1 / 60],
  [/^刻钟?$/u, 0.25],
  [/^(小时|钟头|个钟头|个小时)$/u, HOUR],
  [/^个?时辰$/u, 2 * HOUR],
  [/^(天|日|夜|晚)$/u, DAY],
  [/^(周|个?星期|个?礼拜)$/u, WEEK],
  [/^旬$/u, 10 * DAY],
  [/^个?月$/u, MONTH],
  [/^个?季度?$/u, 3 * MONTH],
  [/^(年|载)$/u, YEAR],
  [/^(个)?世纪$/u, 100 * YEAR],
];
const CN_UNIT = "(秒钟?|分钟|刻钟?|个?小时|个?钟头|个?时辰|天|日|夜|晚|周|个?星期|个?礼拜|旬|个月|个?季度|年|载|个?世纪)";
// Numerals, approximate pairs ("两三", "三四") and vague counts ("几", "数", "好几").
const CN_COUNT = "([零〇一二两三四五六七八九十百千万\\d]+|好几|若干|几|数|多|半)";

const PART_OF_DAY: ReadonlyArray<readonly [RegExp, PartOfDay]> = [
  [/\bmidnight\b|午夜|子夜|半夜/u, "midnight"],
  [/\b(dawn|daybreak|sunrise|first light)\b|黎明|拂晓|破晓|凌晨|天亮/u, "dawn"],
  [/\b(noon|midday)\b|中午|正午|晌午/u, "noon"],
  [/\bafternoon\b|下午|午后/u, "afternoon"],
  [/\bmorning\b|清晨|早晨|早上|上午|翌晨|次晨/u, "morning"],
  [/\b(evening|dusk|twilight|sunset|sundown)\b|傍晚|黄昏|日落|薄暮|夕阳/u, "evening"],
  [/\b(night|nightfall|tonight)\b|晚上|夜晚|夜里|夜间|入夜|深夜|当夜|是夜|当晚/u, "night"],
];
// The twelve 时辰, each two hours, starting at 23:00 with 子时.
const SHICHEN = "子丑寅卯辰巳午未申酉戌亥";

const SEASON_EN = /\b(spring|springtime|summer|summertime|midsummer|autumn|autumnal|fall(?!\s+of)|winter|wintertime|midwinter)\b/u;
const SEASON_CN = /(春|夏|秋|冬)(天|季|日|末|初)|(初|早|仲|暮|晚|深|盛|隆|严|立|入|开)(春|夏|秋|冬)|^(春|夏|秋|冬)$/u;
const CN_SEASON: Record<string, Season> = { 春: "spring", 夏: "summer", 秋: "autumn", 冬: "winter" };

// Words that make a reading uncertain; we would rather skip it than guess.
const HEDGE = /\b(about|around|approximately|approx|roughly|circa|perhaps|maybe|probably|possibly|presumably|unknown|unclear|uncertain|or so|sometime|some time|between|either|until|till)\b|\bc\.\s*\d|\?|大约|大概|左右|约莫|上下|也许|可能|不详|未知|不明|之间|或者|或许/u;
const RANGE = /\d\s*(?:[–—~～]|-(?!\d{1,2}-))\s*\d|\b(to|or|and)\b|至|到/u;

// ---------------------------------------------------------------------------
// Numbers

function englishCount(word: string): number | "vague" | null {
  if (/^\d+(\.\d+)?$/u.test(word)) return Number(word);
  if (VAGUE_COUNT.test(word)) return "vague";
  if (/^half an?$/u.test(word)) return 0.5;
  if (word in WORD_NUMBERS) return WORD_NUMBERS[word]!;
  const [tens, ones] = word.split("-");
  if (ones !== undefined && WORD_NUMBERS[tens!]! >= 20 && (WORD_NUMBERS[ones] ?? 10) < 10) return WORD_NUMBERS[tens!]! + WORD_NUMBERS[ones]!;
  return null;
}

function chineseCount(text: string): number | "vague" | null {
  if (/^(好几|若干|几|数|多)$/u.test(text)) return "vague";
  if (text === "半") return 0.5;
  if (/^\d+$/u.test(text)) return Number(text);
  // "两三天", "三四年": the larger of the two.
  const pair = /^([一二两三四五六七八九])([二三四五六七八九])$/u.exec(text);
  if (pair) return parseQuantity(pair[2]!)?.value ?? null;
  const quantity = parseQuantity(text);
  return quantity && quantity.unit === "" ? quantity.value : null;
}

const unitHours = (units: ReadonlyArray<readonly [RegExp, number]>, word: string) =>
  units.find(([pattern]) => pattern.test(word))?.[1] ?? null;

function elapsedOf(count: number | "vague", unit: number, direction: Elapsed["direction"]): Elapsed {
  if (count === "vague") {
    // "moments later", "hours later" stay within the day; "days later" and longer have no ceiling.
    const maxHours = unit < HOUR ? 1 : unit < DAY ? DAY : Infinity;
    return { direction, hours: 2 * unit, maxHours };
  }
  // A count of whole units rounds down: "three days later" is under four days.
  return { direction, hours: count * unit, maxHours: (Math.max(count, 1) + 1) * unit };
}

// ---------------------------------------------------------------------------
// Relative markers

const EN_LATER = "(later|afterwards?|after|on|hence|passed|have passed|had passed|has passed|went by|go by|gone by|had gone by|elapsed|had elapsed|have elapsed|ago|before|earlier|previously|prior)";
const EN_EARLIER = /^(ago|before|earlier|previously|prior)$/u;
const EN_RELATIVE = new RegExp(`(?:\\b${EN_COUNT}\\s+)?\\b${EN_UNIT}\\s+${EN_LATER}\\b`, "gu");
const EN_AFTER = new RegExp(`\\bafter\\s+${EN_COUNT}\\s+${EN_UNIT}\\b`, "gu");
const EN_NEXT = /\b(?:the\s+)?(?:next|following|subsequent)\s+(dawn|morning|day|afternoon|evening|night|weekend|week|month|year|spring|summer|autumn|fall|winter)\b|\bthe\s+(day|morning|night|evening)\s+after(?:wards?)?\b/gu;
const EN_SAME_DAY = /\b(?:later\s+)?that\s+(morning|afternoon|evening|night|day)\b|\blater\s+(?:that|the\s+same)\s+day\b|\bthe\s+same\s+(day|night|evening|morning|afternoon)\b/gu;

const CN_RELATIVE = new RegExp(`(?:又?过了|经过了?)?${CN_COUNT}${CN_UNIT}(?:多|有余)?(之后|以后|过后|过去了?|后|之前|以前|前)`, "gu");
const CN_PASSED = new RegExp(`(?:又?过了|过去了|经过了?)${CN_COUNT}${CN_UNIT}`, "gu");
const CN_NEXT_DAY = /第二天|第二日|次日|翌日|隔天|隔日|翌晨|次晨|第二天早上|次日清晨/gu;
const CN_NEXT_LONG = /(第二年|次年|翌年|来年|转年)|(下个月|次月|翌月)|(下周|下个星期|次周)/gu;
const CN_SAME_DAY = /当晚|当夜|当天|当日|是夜|这天晚上|那天晚上|同日|同一天/gu;
const CN_SOON = /片刻之?后|须臾|不一会儿?/gu;

const NEXT_UNIT: Record<string, number> = { weekend: WEEK, week: WEEK, month: MONTH, year: YEAR };

function readRelative(text: string): { elapsed: Elapsed[]; rest: string; partOfDay?: PartOfDay; season?: Season } | null {
  const elapsed: Elapsed[] = [];
  let partOfDay: PartOfDay | undefined;
  let season: Season | undefined;
  let rest = text;
  let failed = false;
  const take = (pattern: RegExp, read: (match: RegExpMatchArray) => Elapsed | null) => {
    rest = rest.replace(pattern, (...args) => {
      const match = args.slice(0, -2) as unknown as RegExpMatchArray;
      const reading = read(match);
      if (reading) elapsed.push(reading);
      else failed = true;
      return " ";
    });
  };

  take(EN_NEXT, ([, unit, after]) => {
    const word = (unit ?? after)!;
    if (word in NEXT_UNIT) return { direction: "later", hours: NEXT_UNIT[word]!, maxHours: 2 * NEXT_UNIT[word]! };
    const seasonWord = readSeason(word);
    if (seasonWord) {
      season = seasonWord;
      return { direction: "later", hours: 3 * MONTH, maxHours: 2 * YEAR };
    }
    partOfDay = readPartOfDay(word);
    return { direction: "later", hours: DAY, maxHours: 2 * DAY };
  });
  take(EN_SAME_DAY, ([, a, b]) => {
    partOfDay = readPartOfDay(a ?? b ?? "") ?? partOfDay;
    return { direction: "later", hours: 0, maxHours: DAY };
  });

  take(EN_RELATIVE, ([, count, unit, word]) => {
    const hours = unitHours(EN_UNITS, unit!);
    // A word before the unit that is not a count ("long days later") leaves a plural vague and a singular unread.
    const n = (count === undefined ? null : englishCount(count)) ?? (/s$/u.test(unit!) ? "vague" : null);
    if (hours === null || n === null) return null;
    return elapsedOf(n, hours, EN_EARLIER.test(word!) ? "earlier" : "later");
  });
  take(EN_AFTER, ([, count, unit]) => {
    const hours = unitHours(EN_UNITS, unit!);
    const n = englishCount(count!);
    return hours === null || n === null ? null : elapsedOf(n, hours, "later");
  });
  take(CN_RELATIVE, ([, count, unit, word]) => {
    const hours = unitHours(CN_UNITS, unit!);
    const n = chineseCount(count!);
    // "1891年后" is "after 1891", not 1891 years.
    if (hours === null || n === null || (hours === YEAR && typeof n === "number" && n >= 1000)) return null;
    return elapsedOf(n, hours, /前/u.test(word!) ? "earlier" : "later");
  });
  take(CN_PASSED, ([, count, unit]) => {
    const hours = unitHours(CN_UNITS, unit!);
    const n = chineseCount(count!);
    return hours === null || n === null ? null : elapsedOf(n, hours, "later");
  });
  take(CN_NEXT_DAY, () => ({ direction: "later", hours: DAY, maxHours: 2 * DAY }));
  take(CN_NEXT_LONG, ([, year, month]) => {
    const unit = year ? YEAR : month ? MONTH : WEEK;
    return { direction: "later", hours: unit, maxHours: 2 * unit };
  });
  take(CN_SAME_DAY, () => ({ direction: "later", hours: 0, maxHours: DAY }));
  take(CN_SOON, () => ({ direction: "later", hours: 0, maxHours: 1 }));

  if (failed) return null;
  return { elapsed, rest, ...(partOfDay ? { partOfDay } : {}), ...(season ? { season } : {}) };
}

/** Several markers in one expression ("a week passed; the next morning") add up, if they point the same way. */
function combine(elapsed: Elapsed[]): Elapsed | null | undefined {
  if (elapsed.length === 0) return undefined;
  const direction = elapsed[0]!.direction;
  if (elapsed.some((e) => e.direction !== direction)) return null;
  return {
    direction,
    hours: elapsed.reduce((sum, e) => sum + e.hours, 0),
    maxHours: elapsed.reduce((sum, e) => sum + e.maxHours, 0),
  };
}

// ---------------------------------------------------------------------------
// Absolute parts

function readSeason(text: string): Season | undefined {
  const en = SEASON_EN.exec(text)?.[1];
  if (en) {
    if (en.startsWith("spring")) return "spring";
    if (en.includes("summer")) return "summer";
    if (en.startsWith("autumn") || en === "fall") return "autumn";
    return "winter";
  }
  const cn = SEASON_CN.exec(text);
  const char = cn?.[1] ?? cn?.[4] ?? cn?.[5];
  return char ? CN_SEASON[char] : undefined;
}

function readPartOfDay(text: string): PartOfDay | undefined {
  return PART_OF_DAY.find(([pattern]) => pattern.test(text))?.[1];
}

function readHour(text: string): number | undefined {
  const twelve = /\b(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\b\.?/u.exec(text);
  if (twelve) {
    const hour = Number(twelve[1]);
    if (hour >= 1 && hour <= 12) return (hour % 12) + (twelve[3] === "p" ? 12 : 0);
  }
  const clock = /\b([01]?\d|2[0-3]):([0-5]\d)\b/u.exec(text);
  if (clock) return Number(clock[1]);
  const cn = new RegExp(`([${SHICHEN}])时`, "u").exec(text);
  if (cn) return (SHICHEN.indexOf(cn[1]!) * 2 + 23) % 24;
  return undefined;
}

const CN_DIGIT_YEAR: Record<string, string> = { 〇: "0", 零: "0", 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };

/** Years a text names; more than one distinct year makes the reading unsure. */
function readYears(text: string): number[] {
  const years: number[] = [];
  for (const m of text.matchAll(/\b(?:the\s+)?year\s+(\d{1,4})\b/gu)) years.push(Number(m[1]));
  for (const m of text.matchAll(/\b(\d{1,4})\s*(b\.?c\.?e?|bce)(?![a-z])/gu)) years.push(-Number(m[1]));
  for (const m of text.matchAll(/\b(?:a\.?d\.?|ce)\s+(\d{1,4})\b|\b(\d{1,4})\s+(?:a\.?d\.?|ce)\b/gu)) years.push(Number(m[1] ?? m[2]));
  // A bare four-digit number, not a decade ("1890s"), a time ("1891 hours") or part of a longer number.
  for (const m of text.matchAll(/(?<![\d.,:])\b([12]\d{3})\b(?![\d.,:]|\s*(?:hours|years|days|miles|men|soldiers|b\.?c))/gu)) years.push(Number(m[1]));
  for (const m of text.matchAll(/(公元前)?(\d{3,4}|[〇零一二三四五六七八九]{4})年(?!代|间)/gu)) {
    const digits = [...m[2]!].map((c) => CN_DIGIT_YEAR[c] ?? c).join("");
    years.push(m[1] ? -Number(digits) : Number(digits));
  }
  for (const m of text.matchAll(/公元前(\d{1,4})年/gu)) years.push(-Number(m[1]));
  return [...new Set(years)];
}

const CN_MONTH: Record<string, number> = { 正: 1, 腊: 12, 冬: 11 };

function readCalendar(text: string): { month?: number; day?: number } | null {
  const iso = /\b(\d{3,4})[-/](\d{1,2})[-/](\d{1,2})\b/u.exec(text);
  if (iso) return { month: Number(iso[2]), day: Number(iso[3]) };
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_WORD}(?![a-z])`, "u").exec(text);
  if (dayMonth) return { month: MONTHS[dayMonth[2]!]!, day: Number(dayMonth[1]) };
  const monthDay = new RegExp(`\\b${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*:)`, "u").exec(text);
  if (monthDay) return { month: MONTHS[monthDay[1]!]!, day: Number(monthDay[2]) };
  const monthYear = new RegExp(`\\b${MONTH_WORD},?\\s+(?:of\\s+)?(?:the\\s+year\\s+)?\\d{3,4}\\b`, "u").exec(text);
  if (monthYear) return { month: MONTHS[monthYear[1]!]! };
  const lone = LONE_MONTH.exec(text);
  if (lone) return { month: MONTHS[lone[1]!]! };

  const cn = /(\d{1,2}|十[一二]?|[一二三四五六七八九]|正|腊|冬)月(?:份)?(?:(\d{1,2}|[一二三]?十[一二三四五六七八九]?|[一二三四五六七八九]|初[一二三四五六七八九十])(?:日|号)?)?/u.exec(text);
  if (cn) {
    // A month followed by 后/前 is a count of months ("三月后"), not a name.
    if (/^[后前]/u.test(text.slice(cn.index + cn[0].length))) return null;
    const month = CN_MONTH[cn[1]!] ?? (/^\d+$/u.test(cn[1]!) ? Number(cn[1]) : chineseCount(cn[1]!));
    if (typeof month !== "number") return null;
    const dayText = cn[2]?.replace(/^初/u, "");
    const day = dayText === undefined ? undefined : /^\d+$/u.test(dayText) ? Number(dayText) : chineseCount(dayText);
    if (day === "vague" || day === null) return null;
    return { month, ...(day !== undefined ? { day } : {}) };
  }
  return {};
}

function readWeekday(text: string): number | undefined {
  const en = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/u.exec(text);
  if (en) return WEEKDAYS[en[1]!];
  const cn = /(?:星期|礼拜|周)([日天一二三四五六])/u.exec(text);
  return cn ? CN_WEEKDAYS[cn[1]!] : undefined;
}

function readAgeText(text: string): number | undefined {
  const en = /\b(?:aged?|age of)\s+(\d{1,3})\b|\b(\d{1,3})(?:\s+|-)(?:years?|yrs?)(?:\s+|-)old\b|^(\d{1,3})\s*(?:y\/o|yo)$/u.exec(text);
  if (en) return Number(en[1] ?? en[2] ?? en[3]);
  const cn = /(?<!虚)(?:年龄|年纪)?(\d{1,3}|[一二三四五六七八九十百]+)(?:周)?岁/u.exec(text);
  if (cn && !/虚岁/u.test(text)) {
    const n = chineseCount(cn[1]!);
    if (typeof n === "number") return n;
  }
  return undefined;
}

const BORN_EN = /^(?:was\s+|is\s+)?born\b(?:\s+(?:in|on))?\s*(.*)$|\bb\.\s*(\d{3,4})\b/u;
const BORN_CN = /(?:生于|出生于|出生在|出生)(.*)$|^(.*年)(?:出生|生人?)$/u;

// ---------------------------------------------------------------------------

/**
 * Read a time expression: an explicit date ("12 March 1891", "1891-03-12",
 * "March 1891", "1891"), a weekday, a time of day, a season, a relative marker
 * ("three days later", "the next morning", "a week passed", "二十年前", "三天后"),
 * an age ("age 30") or a birth year ("born 1860"). Null when the text is hedged
 * ("about 1890"), a range ("1890–1893") or names nothing we recognise.
 */
export function parseTime(raw: string): TimeReading | null {
  const text = raw.trim().toLowerCase().replace(/\s+/gu, " ");
  if (text === "" || HEDGE.test(text)) return null;

  const born = BORN_EN.exec(text) ?? BORN_CN.exec(text);
  if (born) {
    if (born[2] && /^\d+$/u.test(born[2])) return { birthYear: Number(born[2]) };
    const years = readYears(born[1] ?? born[2] ?? "");
    return years.length === 1 ? { birthYear: years[0]! } : null;
  }

  if (RANGE.test(text.replace(/\b\d{3,4}-\d{1,2}-\d{1,2}\b/gu, "date"))) return null;

  const relative = readRelative(text);
  if (!relative) return null;
  const elapsed = combine(relative.elapsed);
  if (elapsed === null) return null;
  const rest = relative.rest;

  const age = readAgeText(rest);
  const years = readYears(rest);
  if (years.length > 1) return null;
  const calendar = readCalendar(rest);
  if (!calendar) return null;
  const { month, day } = calendar;
  if (month !== undefined && (month < 1 || month > 12)) return null;
  if (day !== undefined && (day < 1 || day > 31)) return null;
  const isoYear = /\b(\d{3,4})-\d{1,2}-\d{1,2}\b/u.exec(rest)?.[1];
  const year = isoYear ? Number(isoYear) : years[0];

  const season = relative.season ?? readSeason(rest);
  const partOfDay = relative.partOfDay ?? readPartOfDay(text);
  const hour = readHour(rest);
  const weekday = readWeekday(rest);

  const reading: TimeReading = {
    ...(year !== undefined ? { year } : {}),
    ...(month !== undefined ? { month } : {}),
    ...(day !== undefined ? { day } : {}),
    ...(weekday !== undefined ? { weekday } : {}),
    ...(season ? { season } : {}),
    ...(partOfDay ? { partOfDay } : {}),
    ...(hour !== undefined ? { hour } : {}),
    ...(elapsed ? { elapsed } : {}),
    ...(age !== undefined ? { age } : {}),
  };
  return Object.keys(reading).length > 0 ? reading : null;
}

/**
 * A duration without a direction ("three days", "for a week", "三天"), read as
 * time that passes: the object of an "elapsed time" fact.
 */
export function parseDuration(raw: string): Elapsed | null {
  const text = raw.trim().toLowerCase().replace(/\s+/gu, " ").replace(/^(for|over)\s+/u, "");
  if (HEDGE.test(text) || RANGE.test(text)) return null;
  const en = new RegExp(`^${EN_COUNT}\\s+${EN_UNIT}$`, "u").exec(text);
  if (en) {
    const hours = unitHours(EN_UNITS, en[2]!);
    const n = englishCount(en[1]!);
    return hours === null || n === null ? null : elapsedOf(n, hours, "later");
  }
  const cn = new RegExp(`^${CN_COUNT}${CN_UNIT}(?:多|有余)?$`, "u").exec(text);
  if (cn) {
    const hours = unitHours(CN_UNITS, cn[2]!);
    const n = chineseCount(cn[1]!);
    return hours === null || n === null ? null : elapsedOf(n, hours, "later");
  }
  const reading = parseTime(text);
  return reading?.elapsed ?? null;
}

// ---------------------------------------------------------------------------
// Calendar arithmetic

/** Hours since 1970-01-01 at the start of a (possibly overflowing) year, month and day, proleptic Gregorian. */
function hoursAt(year: number, month: number, day = 1): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / 3_600_000;
}

// Meteorological seasons by month; winter spans the turn of the year.
const SEASON_MONTHS: Record<Hemisphere, Record<Season, readonly [first: number, last: number]>> = {
  north: { spring: [3, 5], summer: [6, 8], autumn: [9, 11], winter: [12, 14] },
  south: { spring: [9, 11], summer: [12, 14], autumn: [3, 5], winter: [6, 8] },
};

/**
 * The months a season can include, allowing one month either side: astronomical
 * seasons start three weeks after meteorological ones, climates differ, and
 * "early spring" in late February is normal.
 */
export function seasonMonths(season: Season, hemisphere: Hemisphere = "north"): Set<number> {
  const [first, last] = SEASON_MONTHS[hemisphere][season];
  const months = new Set<number>();
  for (let m = first - 1; m <= last + 1; m += 1) months.add(((m - 1) % 12 + 12) % 12 + 1);
  return months;
}

/** The span of time an absolute reading can mean, in hours since 1970, or null without a year. */
export function dateRange(reading: TimeReading, hemisphere: Hemisphere = "north"): { start: number; end: number } | null {
  const { year, month, day } = reading;
  if (year === undefined) return null;
  if (month !== undefined && day !== undefined) return { start: hoursAt(year, month, day), end: hoursAt(year, month, day + 1) };
  if (month !== undefined) return { start: hoursAt(year, month), end: hoursAt(year, month + 1) };
  if (reading.season) {
    const [first, last] = SEASON_MONTHS[hemisphere][reading.season];
    // "Winter 1891" may be its first months or its last, so it spans both, plus a month of slack either side.
    return first > 12 || last > 12
      ? { start: hoursAt(year, first - 13), end: hoursAt(year, last + 2) }
      : { start: hoursAt(year, first - 1), end: hoursAt(year, last + 2) };
  }
  return { start: hoursAt(year, 1), end: hoursAt(year + 1, 1) };
}

// ---------------------------------------------------------------------------
// Time facts

// Subjects that stand for the story's own clock, not a thing that has a date
// ("the letter · date · 3 May 1880" is not when the scene happens).
const CLOCK_SUBJECT = /^(story|world|timeline|time|narrative|now|present|setting|scene|chapter\d*|plot|book|calendar|date|today|day|clock|current(time|date)?|storytime|故事|世界|时间|时间线|当前|现在|此时|当下|场景|本章|剧情|故事时间|时间轴|日期|今天|今日)$/u;
// Predicates that say "now" whatever the subject.
const CLOCK_PREDICATES = new Set(["currentdate", "currenttime", "currentyear", "currentseason", "today", "当前日期", "当前时间", "当前年份", "今天", "今日"]);
const ELAPSED_PREDICATES = new Set([
  "elapsedtime", "timeelapsed", "timepassed", "timeskip", "timejump", "elapsed", "timesince", "timesincelastchapter", "timesincelastscene",
  "经过时间", "时间流逝", "过去时间", "时间跨度", "时间推移", "过了", "流逝时间",
]);
const YEAR_PREDICATES = new Set(["year", "currentyear", "年份", "当前年份", "年"]);
export const BIRTH_PREDICATES = new Set([
  "born", "birth", "birthyear", "yearofbirth", "dateofbirth", "birthdate", "borninyear", "bornin", "bornon",
  "出生", "出生年份", "出生年", "出生日期", "生年", "生于", "出生于", "出生年月",
]);
// Words in a clock fact that mark a memory or a dream rather than the present.
const NOT_PRESENT = /flashback|memory|memories|remember|recall|dream|vision|backstory|回忆|往事|记忆|梦|当年|昔日/u;

/** True when a fact states the story's clock: a time fact about the story itself, or a "current date" of anything. */
export function isClockFact(fact: CurrentStateFact): boolean {
  const predicate = normalize(fact.predicate);
  if (NOT_PRESENT.test(`${fact.predicate} ${fact.object}`.toLowerCase())) return false;
  if (CLOCK_PREDICATES.has(predicate)) return true;
  return (hasKind(fact, "time") || ELAPSED_PREDICATES.has(predicate)) && CLOCK_SUBJECT.test(normalizeValue(fact.subject));
}

/** What a story-clock fact says the time is, or null when it is not a clock fact or does not parse. */
export function readClock(fact: CurrentStateFact): TimeReading | null {
  if (!isClockFact(fact)) return null;
  const predicate = normalize(fact.predicate);
  // "story · year · 412": a plain number is a year when the predicate says so.
  if (YEAR_PREDICATES.has(predicate) && /^-?\d{1,4}$/u.test(fact.object.trim())) return { year: Number(fact.object.trim()) };
  const reading = parseTime(fact.object);
  if (!reading || reading.age !== undefined || reading.birthYear !== undefined) return null;
  return reading;
}

/**
 * Time a fact says has passed: "story · time · three days later", "Mira · time · the
 * next morning", "time skip · elapsed · a week". Any subject counts, since the rules
 * only use it to allow more time, never less.
 */
export function readElapsed(fact: CurrentStateFact): Elapsed | null {
  if (NOT_PRESENT.test(`${fact.predicate} ${fact.object}`.toLowerCase())) return null;
  const predicate = normalize(fact.predicate);
  if (ELAPSED_PREDICATES.has(predicate)) return parseDuration(fact.object);
  if (!hasKind(fact, "time") && !CLOCK_PREDICATES.has(predicate)) return null;
  return parseTime(fact.object)?.elapsed ?? null;
}

/** A birth year stated by a fact: "Mira · born · 1860", "Mira · is · born in 1860", "林远 · 出生 · 1860年". */
export function readBirthYear(fact: CurrentStateFact): number | null {
  const predicate = normalize(fact.predicate);
  if (BIRTH_PREDICATES.has(predicate)) {
    const object = fact.object.trim();
    if (/^-?\d{3,4}$/u.test(object)) return Number(object);
    const reading = parseTime(object);
    if (reading?.birthYear !== undefined) return reading.birthYear;
    if (reading && reading.elapsed === undefined && reading.year !== undefined) return reading.year;
    return null;
  }
  return parseTime(fact.object)?.birthYear ?? null;
}

/**
 * An age in whole years: an age fact with a plain number ("30", "30 years old",
 * "三十岁"), or any fact whose object says so in words ("Mira · is · 30 years old").
 * Ages in 虚岁 (East Asian reckoning, one more) are skipped, since they do not
 * compare with plain ages.
 */
export function readAge(fact: CurrentStateFact): number | null {
  if (/虚岁/u.test(fact.object)) return null;
  if (hasKind(fact, "age")) {
    const quantity = parseQuantity(fact.object);
    if (quantity && quantity.value >= 0 && /^(|years?|years old|yrs?|y\/o|yo|岁|周岁)$/iu.test(quantity.unit.trim())) return quantity.value;
  }
  const age = parseTime(fact.object)?.age;
  return age === undefined ? null : age;
}

/** Everything the time module can read from one fact, or null. Used by state views and the time rules. */
export function readTimeFact(fact: CurrentStateFact): TimeReading | null {
  const birthYear = readBirthYear(fact);
  if (birthYear !== null) return { birthYear };
  const age = readAge(fact);
  if (age !== null) return { age };
  const clock = readClock(fact);
  if (clock) return clock;
  const elapsed = readElapsed(fact);
  return elapsed ? { elapsed } : null;
}

/** What the story clock says in one chapter: from the facts stated there (`validFromChapter`). */
export interface ChapterTime {
  /** Clock facts that read as a time, in any detail. */
  readonly readings: Array<{ readonly fact: CurrentStateFact; readonly reading: TimeReading }>;
  /** Clock facts with a calendar span (they name a year). */
  readonly dates: Array<{ readonly fact: CurrentStateFact; readonly range: { start: number; end: number } }>;
  /** Facts that say time passes ("three days later") or that the scene looks back ("twenty years ago"). */
  readonly markers: Array<{ readonly fact: CurrentStateFact; readonly elapsed: Elapsed }>;
}

/**
 * The time facts of a snapshot by the chapter that states them. A fact restated
 * unchanged keeps its first chapter (InkOS does not re-add it), so a chapter's
 * entry is what it says anew, never what it inherits.
 */
export function chapterTimes(facts: ReadonlyArray<CurrentStateFact>, hemisphere: Hemisphere = "north"): Map<number, ChapterTime> {
  const times = new Map<number, ChapterTime>();
  const at = (chapter: number) => {
    let time = times.get(chapter);
    if (!time) times.set(chapter, time = { readings: [], dates: [], markers: [] });
    return time;
  };
  for (const fact of facts) {
    const reading = readClock(fact);
    if (reading) {
      const time = at(fact.validFromChapter);
      time.readings.push({ fact, reading });
      const range = dateRange(reading, hemisphere);
      if (range) time.dates.push({ fact, range });
    }
    const elapsed = reading?.elapsed ?? readElapsed(fact);
    if (elapsed) at(fact.validFromChapter).markers.push({ fact, elapsed });
  }
  return times;
}
