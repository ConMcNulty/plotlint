import { describe, expect, it } from "vitest";
import type { CurrentStateFact } from "@actalk/inkos-core";
import { checkSnapshot, FramesFileSchema, singleValuedConflict, timelineOrder } from "../index.js";
import { fact, snapshot } from "./fixtures.js";

const check = (facts: CurrentStateFact[], options?: Record<string, unknown>) =>
  checkSnapshot(snapshot(facts, 20), {
    rules: [timelineOrder],
    ...(options ? { book: { config: { version: 1, rules: { "continuity/timeline-order": { options } } } } } : {}),
  });

describe("continuity/timeline-order: dates", () => {
  it("flags a date that goes backwards between chapters, citing both dates", () => {
    const diagnostics = check([
      fact("story", "date", "12 March 1891", 3, 4),
      fact("story", "date", "2 February 1891", 5),
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "continuity/timeline-order",
      severity: "warning",
      confidence: "extracted",
      chapter: 5,
      summary: "The story's date goes backwards in chapter 5: 2 February 1891, after 12 March 1891 in chapter 3. If chapter 5 is a flashback, mark it in frames.json.",
    });
    expect(diagnostics[0]!.evidence[0]).toMatch(/^date: story · date · 2 February 1891/u);
    expect(diagnostics[0]!.evidence[1]).toMatch(/^earlier date: story · date · 12 March 1891/u);
  });

  it("reads Chinese dates and years", () => {
    expect(check([fact("故事", "日期", "1891年3月12日", 3, 4), fact("故事", "日期", "1890年", 5)]).map((d) => d.chapter)).toEqual([5]);
  });

  it("reports one finding for one misplaced chapter", () => {
    expect(check([
      fact("story", "year", "1891", 3, 4),
      fact("story", "year", "1880", 5, 5),
      fact("story", "year", "1891", 6, 6),
      fact("story", "year", "1892", 7),
    ]).map((d) => d.chapter)).toEqual([5]);
  });

  it("does not flag dates that move forward, stay put or overlap in precision", () => {
    expect(check([
      fact("story", "date", "1891", 1, 1),
      fact("story", "date", "March 1891", 2, 2),
      fact("story", "date", "12 March 1891", 3, 3),
      fact("story", "date", "12 March 1891", 4, 4),
      fact("story", "date", "spring 1891", 5, 5),
      fact("story", "date", "1891-06-01", 6),
    ])).toEqual([]);
  });

  it("ignores dates of things, hedged dates, flashbacks and chapters that look back", () => {
    expect(check([fact("story", "date", "12 March 1891", 3), fact("the letter", "date", "3 May 1880", 5)])).toEqual([]);
    expect(check([fact("story", "date", "12 March 1891", 3, 4), fact("story", "date", "about 1880", 5)])).toEqual([]);
    expect(check([fact("story", "date", "12 March 1891", 3, 4), fact("story", "date", "1880 (flashback)", 5)])).toEqual([]);
    expect(check([
      fact("story", "date", "12 March 1891", 3, 4),
      fact("story", "date", "1871", 5),
      fact("story", "time", "twenty years ago", 5),
    ])).toEqual([]);
  });

  it("leaves chapters marked as flashbacks in frames.json out", () => {
    const facts = [fact("story", "date", "12 March 1891", 3, 4), fact("story", "date", "1871", 5)];
    const frames = FramesFileSchema.parse({ version: 1, frames: [{ chapter: 5, frame: "flashback" }] });
    expect(checkSnapshot(snapshot(facts, 20), { rules: [timelineOrder], book: { frames } })).toEqual([]);
  });
});

describe("continuity/timeline-order: seasons", () => {
  it("flags a season that does not fit the chapter's month", () => {
    const [finding, ...rest] = check([fact("story", "season", "winter", 4), fact("story", "date", "12 July 1891", 4)]);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ chapter: 4, summary: "Chapter 4 is set in winter but in July, which is not winter in the northern hemisphere." });
    expect(finding!.facts).toHaveLength(2);
  });

  it("flags a single fact that names both", () => {
    const [finding] = check([fact("story", "date", "summer, December 1891", 4)]);
    expect(finding?.evidence).toHaveLength(1);
    expect(finding?.evidence[0]).toMatch(/^season and month:/u);
  });

  it("reads Chinese seasons and months", () => {
    expect(check([fact("时间", "季节", "冬天", 4), fact("时间", "日期", "七月", 4)]).map((d) => d.chapter)).toEqual([4]);
  });

  it("allows a month either side of the season", () => {
    expect(check([fact("story", "season", "spring", 4), fact("story", "date", "late February 1891", 4)])).toEqual([]);
    expect(check([fact("story", "season", "winter", 4), fact("story", "date", "March 1891", 4)])).toEqual([]);
  });

  it("swaps seasons for the southern hemisphere", () => {
    const facts = [fact("story", "season", "winter", 4), fact("story", "date", "12 July 1891", 4)];
    expect(check(facts, { hemisphere: "south" })).toEqual([]);
    expect(check([fact("story", "season", "winter", 4), fact("story", "date", "January 1891", 4)], { hemisphere: "south" })).toHaveLength(1);
  });

  it("does not compare a season and a month from different chapters, or across a time skip", () => {
    expect(check([fact("story", "season", "winter", 3, 3), fact("story", "date", "July 1891", 4)])).toEqual([]);
    expect(check([
      fact("story", "date", "December 1890", 4),
      fact("story", "time", "the following summer", 4),
    ])).toEqual([]);
    expect(check([
      fact("story", "date", "December 1890", 4),
      fact("story", "time", "six months later", 4),
      fact("story", "season", "summer", 4),
    ])).toEqual([]);
  });
});

describe("continuity/timeline-order: ages", () => {
  it("flags an age that does not match the birth year and the chapter's year", () => {
    const [finding, ...rest] = check([
      fact("Mira", "born", "1860", 1),
      fact("story", "year", "1891", 4),
      fact("Mira", "age", "25", 4),
    ]);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ chapter: 4, summary: "Mira is 25 in chapter 4, but born in 1860 they would be 30 or 31 in 1891." });
    expect(finding!.evidence.map((line) => line.split(":")[0])).toEqual(["age", "born", "year"]);
  });

  it("accepts either side of a birthday, and an extra year for 岁", () => {
    for (const age of ["30", "31", "31 years old"]) {
      expect(check([fact("Mira", "born", "1860", 1), fact("story", "year", "1891", 4), fact("Mira", "age", age, 4)]), age).toEqual([]);
    }
    expect(check([fact("林远", "出生", "1860年", 1), fact("故事", "年份", "1891", 4), fact("林远", "年龄", "三十二岁", 4)])).toEqual([]);
    expect(check([fact("林远", "出生", "1860年", 1), fact("故事", "年份", "1891", 4), fact("林远", "年龄", "四十岁", 4)])).toHaveLength(1);
  });

  it("with only an earlier year, flags an age that is too low but not one that is higher", () => {
    const base = [fact("Mira", "born", "1860", 1), fact("story", "year", "1891", 2)];
    expect(check([...base, fact("Mira", "age", "25", 6)]).map((d) => d.summary)).toEqual([
      "Mira is 25 in chapter 6, but born in 1860 they were already at least 30 by 1891 (chapter 2).",
    ]);
    // Years may have passed since chapter 2.
    expect(check([...base, fact("Mira", "age", "45", 6)])).toEqual([]);
  });

  it("skips ages without a story year, with two birth years, or in a chapter that looks back", () => {
    expect(check([fact("Mira", "born", "1860", 1), fact("Mira", "age", "25", 4)])).toEqual([]);
    expect(check([fact("Mira", "born", "1860", 1), fact("Mira", "birth year", "1866", 1), fact("story", "year", "1891", 4), fact("Mira", "age", "25", 4)])).toEqual([]);
    expect(check([
      fact("Mira", "born", "1860", 1),
      fact("story", "year", "1871", 4),
      fact("story", "time", "twenty years ago", 4),
      fact("Mira", "age", "10", 4),
    ])).toEqual([]);
  });

  it("flags an age that goes down over time", () => {
    const [finding, ...rest] = check([fact("Mira", "age", "30", 2, 5), fact("Mira", "age", "28", 6)]);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ chapter: 6, summary: "Mira is 28 in chapter 6, younger than the 30 recorded in chapter 2." });
  });

  it("does not flag ages that rise or stay, other characters, or two ages valid at once", () => {
    expect(check([fact("Mira", "age", "30", 2, 5), fact("Mira", "age", "31", 6, 9), fact("Mira", "age", "31 years old", 10)])).toEqual([]);
    expect(check([fact("Mira", "age", "30", 2), fact("Tomas", "age", "12", 6)])).toEqual([]);
    // Overlapping ages are single-valued-conflict's finding, not repeated here.
    const overlapping = [fact("Mira", "age", "30", 2), fact("Mira", "年龄", "28", 6)];
    expect(check(overlapping)).toEqual([]);
    expect(checkSnapshot(snapshot(overlapping, 20), [singleValuedConflict])).toHaveLength(1);
  });
});
