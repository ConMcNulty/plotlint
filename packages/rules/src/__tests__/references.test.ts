import { describe, expect, it } from "vitest";
import { findReferences, referenceNames, referencesOf, type ChapterTexts } from "../index.js";

const chapters: ChapterTexts = new Map([
  [1, "# One\n\nAurel Harrow came down the stair. Harrow's coat was wet.\n"],
  [2, "# Two\n\nMara Harrow waited. Aurel did not.\n"],
  [3, "# Three\n\nNobody here.\n"],
]);

describe("referenceNames", () => {
  it("resolves a short name to the one subject it belongs to, and drops words other subjects share", () => {
    expect(referenceNames(["Aurel Harrow", "Mara Harrow", "Captain Ines Vale"], "Aurel")).toEqual({ entity: "Aurel Harrow", names: ["Aurel Harrow", "Aurel"] });
    expect(referenceNames(["Aurel Harrow", "Captain Ines Vale"], "Captain Ines Vale").names).toEqual(["Captain Ines Vale", "Ines", "Vale"]);
    // Two subjects share "Harrow", so it stays the name it is.
    expect(referenceNames(["Aurel Harrow", "Mara Harrow"], "Harrow")).toEqual({ entity: "Harrow", names: ["Harrow"] });
  });
});

describe("findReferences", () => {
  it("finds whole-word appearances, longest name first, grouped by chapter with line and context", () => {
    const groups = findReferences(chapters, ["Aurel Harrow", "Aurel"]);
    expect(groups.map((group) => [group.chapter, group.hits.map((hit) => hit.text)])).toEqual([[1, ["Aurel Harrow"]], [2, ["Aurel"]]]);
    expect(groups[0]!.hits[0]).toMatchObject({ start: 7, end: 19, line: 3, context: "Aurel Harrow came down the stair. Harrow's coat was wet." });
  });

  it("counts every name of the entity", () => {
    const refs = referencesOf(["Aurel Harrow", "the lantern"], "Harrow", chapters);
    expect(refs.entity).toBe("Aurel Harrow");
    // "Mara Harrow" is not in the state, so her surname counts too.
    expect(refs.total).toBe(4);
    expect(findReferences(new Map([[1, "林青走进来。林青笑了。"]]), ["林青"])[0]!.hits).toHaveLength(2);
  });
});
