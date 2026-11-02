import { describe, expect, it } from "vitest";
import { AUTOSAVE_VERSION_WINDOW_MS, archiveOnSave, savedChapterText } from "../plotlint-autosave.js";

const now = new Date("2026-11-02T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("archiveOnSave", () => {
  it("always archives an explicit save", () => {
    expect(archiveOnSave([{ source: "manual", createdAt: ago(1000) }], false, now)).toBe(true);
  });

  it("archives the first autosave of a chapter with no versions", () => {
    expect(archiveOnSave([], true, now)).toBe(true);
  });

  it("skips autosaves within one stretch of the writer's work", () => {
    expect(archiveOnSave([{ source: "manual", createdAt: ago(60_000) }], true, now)).toBe(false);
  });

  it("archives again once the stretch is over", () => {
    expect(archiveOnSave([{ source: "manual", createdAt: ago(AUTOSAVE_VERSION_WINDOW_MS + 1) }], true, now)).toBe(true);
  });

  it("archives when the latest version is the agent's, so its text is never lost", () => {
    expect(archiveOnSave([{ source: "agent", createdAt: ago(1000) }, { source: "manual", createdAt: ago(2000) }], true, now)).toBe(true);
  });
});

describe("savedChapterText", () => {
  it("normalises like the edit transaction", () => {
    expect(savedChapterText("# One\n\nText")).toBe("# One\n\nText\n");
    expect(savedChapterText("\n# One\n\nText\n\n")).toBe("# One\n\nText\n");
  });
});
