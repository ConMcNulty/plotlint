import { describe, expect, it } from "vitest";
import type { HookRecord } from "@actalk/inkos-core";
import { checkSnapshot, hookBoard, openQuestions, timeline, timelineOrder, type ChapterTexts } from "../index.js";
import { fact, snapshot } from "./fixtures.js";

const hook = (hookId: string, startChapter: number, status: HookRecord["status"], lastAdvancedChapter: number): HookRecord => ({
  hookId, startChapter, type: "mystery", status, lastAdvancedChapter, expectedPayoff: `the answer to ${hookId}`, notes: "",
});

const chapters: ChapterTexts = new Map([1, 2, 3, 4, 5, 6].map((n) => [n, `# Chapter ${n}\n\nText.`]));

describe("hookBoard", () => {
  it("puts open hooks first, oldest wait first, with their age and the findings that name them", () => {
    const state = { ...snapshot([], 6), hooks: { hooks: [
      hook("lantern", 1, "progressing", 2), hook("letter", 3, "open", 5), hook("ring", 1, "resolved", 4),
      hook("map", 2, "superseded", 3), hook("outline-only", 0, "open", 0),
    ] } };
    const board = hookBoard(state, undefined, chapters, [
      { ruleId: "structure/unpaid-setup", layer: "structure", severity: "warning", confidence: "extracted", code: "x", chapter: 6, summary: "A promise is still open.", evidence: ["open: the answer to lantern (lantern)"] },
    ]);
    expect(board.cards.map((card) => [card.id, card.column, card.age])).toEqual([
      ["lantern", "open", 4], ["letter", "open", 1], ["outline-only", "open", null], ["ring", "resolved", null], ["map", "dropped", null],
    ]);
    expect(board.cards[0]!.findings).toHaveLength(1);
    expect(board.cards[1]!.findings).toHaveLength(0);
    expect(board.cards.find((card) => card.id === "outline-only")!.offPage).toBe(true);
    // ring is open in 1..3, map in 2..3, lantern from 1, letter from 3.
    expect(board.openPerChapter.slice(1)).toEqual([2, 3, 4, 2, 2, 2]);
    // The same curve the open-questions check reads.
    expect(checkSnapshot(state, { rules: [openQuestions], chapters })).toEqual([]);
  });
});

describe("timeline", () => {
  it("places chapters by date or by elapsed time, holds the clock on a flashback, and attaches conflicts", () => {
    const state = snapshot([
      fact("story", "date", "3 March 1891", 1, 1),
      fact("story", "time", "three days later", 2, 2),
      fact("story", "time", "twenty years ago", 3, 3),
      fact("story", "date", "1 February 1891", 5),
    ], 6);
    const diagnostics = checkSnapshot(state, { rules: [timelineOrder], chapters });
    const line = timeline(state, chapters, diagnostics);
    const byChapter = new Map(line.chapters.map((chapter) => [chapter.chapter, chapter]));
    expect(byChapter.get(1)).toMatchObject({ basis: "date", looksBack: false });
    expect(byChapter.get(2)).toMatchObject({ basis: "elapsed", at: byChapter.get(1)!.at! + 72 });
    expect(byChapter.get(3)).toMatchObject({ basis: "unknown", at: null, looksBack: true });
    expect(byChapter.get(4)).toMatchObject({ basis: "unknown", at: null });
    expect(byChapter.get(5)!.conflicts.map((d) => d.ruleId)).toEqual(["continuity/timeline-order"]);
    expect(byChapter.get(5)!.dates[0]!.label).toBe("story / date / 1 February 1891");
    expect(line.unplaced).toEqual([]);
  });
});
