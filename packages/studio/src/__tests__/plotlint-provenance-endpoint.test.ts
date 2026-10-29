import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager } from "@actalk/inkos-core";
import { createStudioServer } from "../api/server.js";
import { recordStudioEdit } from "../api/plotlint-provenance.js";

const BOOK = "harbour-book";

describe("plotlint provenance", () => {
  let root: string;
  let bookDir: string;
  const chapterPath = () => join(bookDir, "chapters", "0001_one.md");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-provenance-"));
    bookDir = new StateManager(root).bookDir(BOOK);
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(chapterPath(), "# One\n\nThe tide came in at dusk. Nobody saw the boat.\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const get = (query = "") => createStudioServer({} as never, root).request(`/api/v1/plotlint/provenance/${BOOK}${query}`);

  it("records a Studio save as the writer's edit and reports spans and shares", async () => {
    const before = await readFile(chapterPath(), "utf-8");
    await writeFile(chapterPath(), before.replace("Nobody saw the boat.", "Only Nell saw the boat, and she said nothing."));
    await recordStudioEdit(bookDir, 1, before, "imported");

    const record = JSON.parse(await readFile(join(bookDir, "story", "plotlint", "provenance.json"), "utf-8"));
    expect(record.chapters[0].segments.map((segment: { by: string }) => segment.by)).toEqual(expect.arrayContaining(["import", "human"]));

    const view = await (await get("?chapter=1")).json();
    expect(view.chapter.current).toBe(true);
    expect(view.chapter.spans.some((span: { by: string; via?: string }) => span.by === "human" && span.via === "studio")).toBe(true);
    expect(view.summary.byKind.human.words).toBeGreaterThan(0);
    expect(view.summary.byKind.import.words).toBeGreaterThan(0);
  });

  it("counts chapters with no record as unknown and rejects bad requests", async () => {
    const view = await (await get()).json();
    expect(view.summary.byKind.unknown.share).toBe(1);
    expect((await get("?chapter=x")).status).toBe(400);
    expect((await createStudioServer({} as never, root).request("/api/v1/plotlint/provenance/..%2Fetc")).status).toBe(400);
  });
});
