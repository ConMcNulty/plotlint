import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChapterAutosaver, sameChapterText, type SaveStatus } from "../autosave";

describe("ChapterAutosaver", () => {
  let text: string;
  let writes: Array<{ text: string; autosave: boolean }>;
  let statuses: SaveStatus[];
  let fail: boolean;
  const make = () => new ChapterAutosaver({
    saved: "one",
    read: () => text,
    write: async (value, autosave) => {
      if (fail) throw new Error("disk full");
      writes.push({ text: value, autosave });
    },
    onStatus: (status) => statuses.push(status),
    delayMs: 1000,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    text = "one";
    writes = [];
    statuses = [];
    fail = false;
  });
  afterEach(() => vi.useRealTimers());

  it("saves once typing pauses, not on every keystroke", async () => {
    const saver = make();
    text = "one t";
    saver.changed();
    await vi.advanceTimersByTimeAsync(500);
    text = "one two";
    saver.changed();
    await vi.advanceTimersByTimeAsync(999);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([{ text: "one two", autosave: true }]);
    expect(saver.currentStatus).toBe("saved");
    expect(statuses).toContain("unsaved");
  });

  it("saves at once on flush, so leaving the chapter keeps the edits without asking", async () => {
    const saver = make();
    text = "one two";
    saver.changed();
    expect(await saver.flush()).toBe(true);
    expect(writes).toEqual([{ text: "one two", autosave: true }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toHaveLength(1);
  });

  it("does not write when nothing changed", async () => {
    const saver = make();
    saver.changed();
    expect(await saver.flush()).toBe(true);
    expect(writes).toEqual([]);
    expect(saver.isDirty()).toBe(false);
  });

  it("an undo back to the saved text is clean again", async () => {
    const saver = make();
    text = "one two";
    saver.changed();
    text = "one";
    saver.changed();
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual([]);
    expect(saver.currentStatus).toBe("saved");
  });

  it("reports a failed save and keeps the edits dirty", async () => {
    const saver = make();
    fail = true;
    text = "one two";
    saver.changed();
    expect(await saver.flush()).toBe(false);
    expect(saver.currentStatus).toBe("error");
    expect(saver.isDirty()).toBe(true);
    fail = false;
    expect(await saver.flush()).toBe(true);
    expect(saver.isDirty()).toBe(false);
  });

  it("holds timed saves while paused but still saves on flush", async () => {
    const saver = make();
    saver.setPaused(true);
    text = "one two";
    saver.changed();
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toEqual([]);
    expect(saver.currentStatus).toBe("unsaved");
    await saver.flush();
    expect(writes).toEqual([{ text: "one two", autosave: true }]);
  });

  it("marks an explicit save so the server keeps a version", async () => {
    const saver = make();
    text = "one two";
    await saver.flush(false);
    expect(writes).toEqual([{ text: "one two", autosave: false }]);
  });

  it("saves again when the writer typed during a save", async () => {
    let release: () => void = () => {};
    const saver = new ChapterAutosaver({
      saved: "one",
      read: () => text,
      write: (value) => new Promise<void>((resolve) => { writes.push({ text: value, autosave: true }); release = resolve; }),
      delayMs: 1000,
    });
    text = "one two";
    const first = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    text = "one two three";
    saver.changed();
    release();
    await first;
    expect(saver.currentStatus).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(1000);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.map((write) => write.text)).toEqual(["one two", "one two three"]);
  });
});

describe("sameChapterText", () => {
  it("treats a file with CRLF line endings or a trailing newline as the editor's text", () => {
    expect(sameChapterText("# One\n\nText", "# One\r\n\r\nText\r\n")).toBe(true);
    expect(sameChapterText("# One\n\nText", "# One\n\nText\n")).toBe(true);
    expect(sameChapterText("# One\n\nText", "# One\n\nTexts\n")).toBe(false);
  });
});
