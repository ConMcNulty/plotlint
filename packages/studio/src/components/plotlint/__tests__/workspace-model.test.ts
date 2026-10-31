import { describe, expect, it } from "vitest";
import { chapterToOpen, initialSidePanel, neighbours, parseSidePanel } from "../workspace-model";

const chapters = [{ number: 1 }, { number: 2 }, { number: 4 }];

describe("book workspace", () => {
  it("opens on the chapter asked for, else the latest", () => {
    expect(chapterToOpen(chapters, 2)).toBe(2);
    expect(chapterToOpen(chapters)).toBe(4);
    expect(chapterToOpen(chapters, 3)).toBe(4);
    expect(chapterToOpen([])).toBeNull();
  });

  it("finds the chapters either side, skipping gaps", () => {
    expect(neighbours(chapters, 2)).toEqual({ previous: 1, next: 4 });
    expect(neighbours(chapters, 1)).toEqual({ previous: null, next: 2 });
    expect(neighbours(chapters, 4)).toEqual({ previous: 2, next: null });
  });

  it("opens on the text alone unless the book has no chapters yet", () => {
    expect(initialSidePanel(null, 3)).toEqual({ open: false, tab: "chat" });
    expect(initialSidePanel(null, 0)).toEqual({ open: true, tab: "chat" });
  });

  it("keeps the writer's saved panel choice, ignoring anything malformed", () => {
    expect(initialSidePanel(JSON.stringify({ open: true, tab: "book" }), 3)).toEqual({ open: true, tab: "book" });
    expect(parseSidePanel("{not json")).toBeNull();
    expect(parseSidePanel(JSON.stringify({ open: "yes", tab: "chat" }))).toBeNull();
    expect(parseSidePanel(JSON.stringify({ open: true, tab: "files" }))).toBeNull();
  });
});
