import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, listChapterVersions } from "@actalk/inkos-core";
import { createStudioServer } from "../api/server.js";

const BOOK = "fen-book";
const TEXT = "# Chapter 1\n\nMira walked to the pier.\n";

describe("saving a chapter as the writer types", () => {
  let root: string;
  let bookDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-autosave-"));
    const state = new StateManager(root);
    bookDir = state.bookDir(BOOK);
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0001_Pier.md"), TEXT);
    const at = "2026-01-01T00:00:00.000Z";
    await state.saveChapterIndex(BOOK, [{ number: 1, title: "Pier", wordCount: 5, createdAt: at, updatedAt: at, observations: [], provenance: "imported" }]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const app = () => createStudioServer({} as never, root);
  const save = (content: string, autosave?: boolean) => app().request(`/api/v1/books/${BOOK}/chapters/1`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(autosave === undefined ? { content } : { content, autosave }),
  });
  const file = () => readFile(join(bookDir, "chapters", "0001_Pier.md"), "utf-8");

  it("keeps one version per stretch of autosaves", async () => {
    const first = await save("# Chapter 1\n\nMira walked to the old pier.", true);
    expect(first.status, await first.clone().text()).toBe(200);
    expect((await save("# Chapter 1\n\nMira walked to the old stone pier.", true)).status).toBe(200);
    expect((await save("# Chapter 1\n\nMira ran to the old stone pier.", true)).status).toBe(200);
    expect(await file()).toBe("# Chapter 1\n\nMira ran to the old stone pier.\n");
    const versions = await listChapterVersions(bookDir, 1);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ source: "manual" });
  });

  it("an explicit save always keeps a version", async () => {
    expect((await save("# Chapter 1\n\nMira walked to the old pier.", true)).status).toBe(200);
    expect((await save("# Chapter 1\n\nMira ran to the old pier.")).status).toBe(200);
    expect(await listChapterVersions(bookDir, 1)).toHaveLength(2);
  });

  it("a save that changes nothing succeeds without a version", async () => {
    const response = await save("# Chapter 1\n\nMira walked to the pier.", true);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, unchanged: true });
    expect(await listChapterVersions(bookDir, 1)).toHaveLength(0);
  });
});
