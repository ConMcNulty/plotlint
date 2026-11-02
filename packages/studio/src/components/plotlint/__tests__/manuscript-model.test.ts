import { describe, expect, it } from "vitest";
import { lineStarts, offsetInLines, passageTitle } from "../manuscript-model";

describe("continuous manuscript", () => {
  const text = "# One\n\nMira ran.\nTomas waited.\n";
  const lines = text.split("\n");
  const starts = lineStarts(lines);

  it("maps each line to where it starts in the chapter text", () => {
    expect(starts).toEqual([0, 6, 7, 17, 31]);
    starts.forEach((start, index) => expect(text.slice(start, start + lines[index]!.length)).toBe(lines[index]));
  });

  it("turns a click in a line into an offset in the chapter text", () => {
    expect(offsetInLines(starts, 2, 5)).toBe(12);
    expect(text.slice(offsetInLines(starts, 3, 0), offsetInLines(starts, 3, 5))).toBe("Tomas");
  });

  it("keeps the offset inside the clicked line", () => {
    expect(offsetInLines(starts, 2, 99)).toBe(16);
    expect(offsetInLines(starts, 2, -3)).toBe(7);
    expect(offsetInLines(starts, 9, 1)).toBe(0);
  });

  it("titles a chapter without one by its number", () => {
    expect(passageTitle({ number: 3, title: "Midnight" }, "Chapter {n}")).toBe("Midnight");
    expect(passageTitle({ number: 3, title: " " }, "Chapter {n}")).toBe("Chapter 3");
  });
});
