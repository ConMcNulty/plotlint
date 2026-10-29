import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, archiveChapterVersion } from "@actalk/inkos-core";
import { createStudioServer } from "../api/server.js";

const BOOK = "fen-book";
const BEFORE = "# Chapter 1\n\nMira walked to the pier.\n";
const AFTER = "# Chapter 1\n\nMira ran down to the old pier.\n";

describe("plotlint agent edit review", () => {
  let root: string;
  let bookDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-review-"));
    bookDir = new StateManager(root).bookDir(BOOK);
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0001_Pier.md"), AFTER);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const app = () => createStudioServer({} as never, root);
  const pending = async (chapter = 1) => (await (await app().request(`/api/v1/plotlint/review/${BOOK}/${chapter}`)).json()).pending;
  const mark = (versionId: unknown) => app().request(`/api/v1/plotlint/review/${BOOK}/1`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId }),
  });

  it("offers the newest agent edit for review until it is marked reviewed", async () => {
    expect(await pending()).toBeNull();
    await archiveChapterVersion(bookDir, 1, BEFORE, "revision");
    const edit = await pending();
    expect(edit).toMatchObject({ source: "revision", before: BEFORE });

    expect((await mark("1700000000000_revision_00000000-0000-0000-0000-000000000000")).status).toBe(400);
    expect((await mark(undefined)).status).toBe(400);
    expect((await mark(edit.versionId)).status).toBe(200);
    expect(await pending()).toBeNull();
    expect(JSON.parse(await readFile(join(bookDir, "story", "plotlint", "reviews.json"), "utf-8")).reviewed).toEqual({ 1: edit.versionId });
  });

  it("does not offer the writer's own saves or an edit already undone", async () => {
    await archiveChapterVersion(bookDir, 1, BEFORE, "manual");
    expect(await pending()).toBeNull();
    await archiveChapterVersion(bookDir, 1, AFTER, "agent");
    expect(await pending()).toBeNull();
    expect((await app().request(`/api/v1/plotlint/review/${BOOK}/0`)).status).toBe(400);
  });
});
