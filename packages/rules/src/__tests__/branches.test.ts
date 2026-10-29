import { describe, expect, it } from "vitest";
import type { HookRecord } from "@actalk/inkos-core";
import { diffBranches } from "../index.js";
import { fact, snapshot } from "./fixtures.js";

const hook = (hookId: string, status: HookRecord["status"]): HookRecord =>
  ({ hookId, startChapter: 1, type: "mystery", status, lastAdvancedChapter: 2, expectedPayoff: `the ${hookId}`, notes: "" });

describe("diffBranches", () => {
  it("reports changed chapters, end-state facts and hooks that differ", () => {
    const main = { ...snapshot([fact("Pell", "status", "alive", 1), fact("Nell", "holds", "key", 1), fact("Nell", "location", "mill", 1, 2)], 3), hooks: { hooks: [hook("box", "open"), hook("ring", "resolved")] } };
    const branch = { ...snapshot([fact("Pell", "status", "dead", 3), fact("Nell", "holds", "key", 1), fact("Nell", "holds", "letter", 2)], 3), hooks: { hooks: [hook("box", "resolved"), hook("ring", "resolved")] } };
    const diff = diffBranches(
      { texts: new Map([[1, "Nell ran."], [2, "Pell lived on."], [3, "The end."]]), snapshot: main },
      { texts: new Map([[1, "Nell ran."], [2, "Pell drowned in the race."], [4, "After."]]), snapshot: branch },
    );
    expect(diff.chapters).toEqual([
      { chapter: 2, status: "changed", wordsAdded: 4, wordsRemoved: 2 },
      { chapter: 3, status: "removed", wordsAdded: 0, wordsRemoved: 2 },
      { chapter: 4, status: "added", wordsAdded: 1, wordsRemoved: 0 },
    ]);
    expect(diff.facts).toEqual([
      { subject: "Nell", predicate: "holds", main: null, branch: "letter" },
      { subject: "Pell", predicate: "status", main: "alive", branch: "dead" },
    ]);
    expect(diff.hooks).toEqual([{ id: "box", promise: "the box", main: "open", branch: "resolved" }]);
  });
});
