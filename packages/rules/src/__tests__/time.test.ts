import { describe, expect, it } from "vitest";
import {
  chapterTimes, dateRange, isClockFact, parseDuration, parseTime, readAge, readBirthYear, readClock, readElapsed, seasonMonths,
} from "../index.js";
import { fact, kinded } from "./fixtures.js";

const DAY = 24;

describe("parseTime", () => {
  it("reads explicit dates in common shapes", () => {
    expect(parseTime("12 March 1891")).toEqual({ year: 1891, month: 3, day: 12 });
    expect(parseTime("the 12th of March, 1891")).toEqual({ year: 1891, month: 3, day: 12 });
    expect(parseTime("March 12, 1891")).toEqual({ year: 1891, month: 3, day: 12 });
    expect(parseTime("1891-03-12")).toEqual({ year: 1891, month: 3, day: 12 });
    expect(parseTime("March 1891")).toEqual({ year: 1891, month: 3 });
    expect(parseTime("1891")).toEqual({ year: 1891 });
    expect(parseTime("the year 412")).toEqual({ year: 412 });
    expect(parseTime("44 BC")).toEqual({ year: -44 });
    expect(parseTime("12 May 1891")).toEqual({ year: 1891, month: 5, day: 12 });
    expect(parseTime("July")).toEqual({ month: 7 });
  });

  it("reads Chinese dates", () => {
    expect(parseTime("1891年3月12日")).toEqual({ year: 1891, month: 3, day: 12 });
    expect(parseTime("一八九一年三月")).toEqual({ year: 1891, month: 3 });
    expect(parseTime("十二月二十五日")).toEqual({ month: 12, day: 25 });
    expect(parseTime("公元前221年")).toEqual({ year: -221 });
    expect(parseTime("腊月")).toEqual({ month: 12 });
  });

  it("reads weekdays, times of day and seasons", () => {
    expect(parseTime("Monday morning")).toEqual({ weekday: 1, partOfDay: "morning" });
    expect(parseTime("星期三")).toEqual({ weekday: 3 });
    expect(parseTime("evening")).toEqual({ partOfDay: "evening" });
    expect(parseTime("3 pm")).toEqual({ hour: 15 });
    expect(parseTime("21:30")).toEqual({ hour: 21 });
    expect(parseTime("子时")).toEqual({ hour: 23 });
    expect(parseTime("深夜")).toEqual({ partOfDay: "night" });
    expect(parseTime("late autumn 1891")).toEqual({ year: 1891, season: "autumn" });
    expect(parseTime("in the fall")).toEqual({ season: "autumn" });
    expect(parseTime("初春")).toEqual({ season: "spring" });
    expect(parseTime("冬天")).toEqual({ season: "winter" });
  });

  it("reads relative markers with a plain value and a ceiling", () => {
    expect(parseTime("three days later")?.elapsed).toEqual({ direction: "later", hours: 3 * DAY, maxHours: 4 * DAY });
    expect(parseTime("a week passed")?.elapsed).toEqual({ direction: "later", hours: 7 * DAY, maxHours: 14 * DAY });
    expect(parseTime("twenty-one days had passed")?.elapsed?.hours).toBe(21 * DAY);
    expect(parseTime("after two hours")?.elapsed).toEqual({ direction: "later", hours: 2, maxHours: 3 });
    expect(parseTime("half an hour later")?.elapsed?.hours).toBe(0.5);
    expect(parseTime("twenty years ago")?.elapsed?.direction).toBe("earlier");
    expect(parseTime("two days before the wedding")?.elapsed?.direction).toBe("earlier");
  });

  it("reads 'the next morning' and same-day markers", () => {
    expect(parseTime("the next morning")).toEqual({ partOfDay: "morning", elapsed: { direction: "later", hours: DAY, maxHours: 2 * DAY } });
    expect(parseTime("the following day")?.elapsed?.maxHours).toBe(2 * DAY);
    expect(parseTime("the day after")?.elapsed?.hours).toBe(DAY);
    expect(parseTime("later that night")).toEqual({ partOfDay: "night", elapsed: { direction: "later", hours: 0, maxHours: DAY } });
    expect(parseTime("the following spring")?.season).toBe("spring");
    expect(parseTime("the following spring")?.elapsed?.maxHours).toBeGreaterThan(300 * DAY);
  });

  it("reads Chinese relative markers", () => {
    expect(parseTime("三天后")?.elapsed).toEqual({ direction: "later", hours: 3 * DAY, maxHours: 4 * DAY });
    expect(parseTime("二十年前")?.elapsed?.direction).toBe("earlier");
    expect(parseTime("过了三天")?.elapsed?.hours).toBe(3 * DAY);
    expect(parseTime("半个月后")?.elapsed?.hours).toBeCloseTo(15.2 * DAY, 0);
    expect(parseTime("两个时辰后")?.elapsed?.hours).toBe(4);
    expect(parseTime("两三天后")?.elapsed?.hours).toBe(3 * DAY);
    expect(parseTime("第二天早上")).toEqual({ partOfDay: "morning", elapsed: { direction: "later", hours: DAY, maxHours: 2 * DAY } });
    expect(parseTime("当晚")?.elapsed?.maxHours).toBe(DAY);
  });

  it("leaves vague counts unbounded beyond a day", () => {
    expect(parseTime("days later")?.elapsed?.maxHours).toBe(Infinity);
    expect(parseTime("many years later")?.elapsed?.maxHours).toBe(Infinity);
    expect(parseTime("几天后")?.elapsed?.maxHours).toBe(Infinity);
    expect(parseTime("hours later")?.elapsed?.maxHours).toBe(DAY);
    expect(parseTime("moments later")?.elapsed?.maxHours).toBe(1);
  });

  it("reads ages and birth years", () => {
    expect(parseTime("age 30")).toEqual({ age: 30 });
    expect(parseTime("30 years old")).toEqual({ age: 30 });
    expect(parseTime("a 30-year-old")).toEqual({ age: 30 });
    expect(parseTime("三十岁")).toEqual({ age: 30 });
    expect(parseTime("born 1860")).toEqual({ birthYear: 1860 });
    expect(parseTime("born on 12 March 1860")).toEqual({ birthYear: 1860 });
    expect(parseTime("b. 1860")).toEqual({ birthYear: 1860 });
    expect(parseTime("生于1860年")).toEqual({ birthYear: 1860 });
    expect(parseTime("1860年出生")).toEqual({ birthYear: 1860 });
  });

  it("returns null when unsure", () => {
    for (const text of [
      "", "about 1890", "around noon", "circa 1891", "1890–1893", "1890-1893", "1891 or 1892", "between March and May",
      "sometime in spring?", "大约三天后", "三天左右", "the 3rd of Frostmonth", "later", "soon", "three long day later",
      "三月后", "1891年后", "1200 BC and 1200", "出生入死",
    ]) {
      expect(parseTime(text), text).toBeNull();
    }
  });

  it("does not read decades, durations or numbers as years", () => {
    expect(parseTime("the 1890s")).toBeNull();
    expect(parseTime("1891 hours")).toBeNull();
  });
});

describe("parseDuration", () => {
  it("reads durations as time that passes", () => {
    expect(parseDuration("three days")).toEqual({ direction: "later", hours: 3 * DAY, maxHours: 4 * DAY });
    expect(parseDuration("for a week")?.hours).toBe(7 * DAY);
    expect(parseDuration("三天")?.hours).toBe(3 * DAY);
    expect(parseDuration("two days later")?.hours).toBe(2 * DAY);
    expect(parseDuration("about three days")).toBeNull();
    expect(parseDuration("a while")).toBeNull();
  });
});

describe("calendar spans", () => {
  it("spans a day, a month, a year or a season with slack", () => {
    const day = dateRange({ year: 1891, month: 3, day: 12 })!;
    expect(day.end - day.start).toBe(DAY);
    const month = dateRange({ year: 1891, month: 2 })!;
    expect(month.end - month.start).toBe(28 * DAY);
    const year = dateRange({ year: 1891 })!;
    expect(year.end - year.start).toBe(365 * DAY);
    expect(dateRange({ month: 3 })).toBeNull();
    // Winter 1891 may be Jan–Feb 1891 or Dec 1891–Feb 1892, plus slack: Nov 1890 to the end of March 1892.
    const winter = dateRange({ year: 1891, season: "winter" })!;
    expect(winter.start).toBe(dateRange({ year: 1890, month: 11 })!.start);
    expect(winter.end).toBe(dateRange({ year: 1892, month: 3 })!.end);
  });

  it("allows a month either side of a season, and swaps hemispheres", () => {
    expect([...seasonMonths("winter")].sort((a, b) => a - b)).toEqual([1, 2, 3, 11, 12]);
    expect([...seasonMonths("summer")].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9]);
    expect(seasonMonths("winter", "south").has(7)).toBe(true);
    expect(seasonMonths("winter", "south").has(1)).toBe(false);
  });
});

describe("time facts", () => {
  it("reads the story clock only from story-level subjects or 'current date' predicates", () => {
    expect(readClock(fact("story", "date", "12 March 1891", 3))).toEqual({ year: 1891, month: 3, day: 12 });
    expect(readClock(fact("时间", "季节", "冬天", 3))).toEqual({ season: "winter" });
    expect(readClock(fact("Mira", "current date", "12 March 1891", 3))).toEqual({ year: 1891, month: 3, day: 12 });
    expect(readClock(fact("story", "year", "412", 3))).toEqual({ year: 412 });
    expect(readClock(kinded("time", "timeline", "is", "spring 1891", 3))).toEqual({ year: 1891, season: "spring" });
    // A thing with a date is not the story's present.
    expect(readClock(fact("the letter", "date", "3 May 1880", 3))).toBeNull();
    expect(readClock(fact("story", "date", "1871 (flashback)", 3))).toBeNull();
    expect(isClockFact(fact("story", "mood", "1891", 3))).toBe(false);
  });

  it("reads elapsed time from any time fact and from elapsed-time predicates", () => {
    expect(readElapsed(fact("Mira", "time", "the next morning", 3))?.hours).toBe(DAY);
    expect(readElapsed(fact("journey", "elapsed time", "three days", 3))?.hours).toBe(3 * DAY);
    expect(readElapsed(fact("story", "时间流逝", "三天", 3))?.hours).toBe(3 * DAY);
    expect(readElapsed(fact("Mira", "mood", "three days later", 3))).toBeNull();
    expect(readElapsed(fact("story", "time", "a dream of three days later", 3))).toBeNull();
  });

  it("reads birth years and ages", () => {
    expect(readBirthYear(fact("Mira", "born", "1860", 1))).toBe(1860);
    expect(readBirthYear(fact("Mira", "date of birth", "12 March 1860", 1))).toBe(1860);
    expect(readBirthYear(fact("Mira", "is", "born in 1860", 1))).toBe(1860);
    expect(readBirthYear(fact("林远", "出生", "1860年", 1))).toBe(1860);
    expect(readBirthYear(fact("Mira", "birthplace", "1860 Harbour Row", 1))).toBeNull();
    expect(readAge(fact("Mira", "age", "30", 1))).toBe(30);
    expect(readAge(fact("Mira", "年龄", "十七岁", 1))).toBe(17);
    expect(readAge(fact("Mira", "is", "30 years old", 1))).toBe(30);
    expect(readAge(fact("Mira", "年龄", "虚岁十七", 1))).toBeNull();
    expect(readAge(fact("Mira", "age", "about thirty", 1))).toBeNull();
  });

  it("groups clock facts and markers by the chapter that states them", () => {
    const times = chapterTimes([
      fact("story", "date", "12 March 1891", 3, 4),
      fact("story", "date", "15 March 1891", 5),
      fact("Mira", "time", "three days later", 5),
    ]);
    expect([...times.keys()].sort()).toEqual([3, 5]);
    expect(times.get(5)!.dates).toHaveLength(1);
    expect(times.get(5)!.markers.map((m) => m.elapsed.hours)).toEqual([3 * DAY]);
  });
});
