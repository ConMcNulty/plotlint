import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, saveRuntimeStateSnapshot, type CurrentStateFact, type HookRecord } from "@actalk/inkos-core";
import { createStudioServer } from "../api/server.js";

const BOOK = "harbour-book";

const fact = (subject: string, predicate: string, object: string, from: number, until: number | null = null): CurrentStateFact =>
  ({ subject, predicate, object, validFromChapter: from, validUntilChapter: until, sourceChapter: from });
const hook = (hookId: string, startChapter: number, status: HookRecord["status"], lastAdvancedChapter: number): HookRecord =>
  ({ hookId, startChapter, type: "mystery", status, lastAdvancedChapter, expectedPayoff: `who took the ${hookId}`, notes: "" });

describe("plotlint boards", () => {
  let root: string;
  let bookDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-boards-"));
    bookDir = new StateManager(root).bookDir(BOOK);
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    for (const n of [1, 2, 3]) await writeFile(join(bookDir, "chapters", `000${n}_c.md`), `# Chapter ${n}\n\nThe tide came in.\n`);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const get = () => createStudioServer({} as never, root).request(`/api/v1/plotlint/boards/${BOOK}`);

  it("says when the book has no state yet", async () => {
    expect(await (await get()).json()).toEqual({ stateMissing: true, hooks: null, timeline: null });
  });

  it("returns the hook board and the timeline with the date that goes backwards", async () => {
    await saveRuntimeStateSnapshot(bookDir, {
      manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 3, projectionVersion: 1 },
      currentState: { chapter: 3, facts: [fact("story", "date", "12 March 1891", 1, 2), fact("story", "date", "2 February 1891", 3)] },
      hooks: { hooks: [hook("lantern", 1, "open", 1), hook("ring", 1, "resolved", 3)] },
      chapterSummaries: { rows: [] },
    });
    const boards = await (await get()).json();
    expect(boards.stateMissing).toBe(false);
    expect(boards.hooks.cards.map((card: { id: string; column: string; age: number | null }) => [card.id, card.column, card.age]))
      .toEqual([["lantern", "open", 2], ["ring", "resolved", null]]);
    const ch3 = boards.timeline.chapters.find((chapter: { chapter: number }) => chapter.chapter === 3);
    expect(ch3.conflicts.map((finding: { ruleId: string }) => finding.ruleId)).toEqual(["continuity/timeline-order"]);
  });
});
