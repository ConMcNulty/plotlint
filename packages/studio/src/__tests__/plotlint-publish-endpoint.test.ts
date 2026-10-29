import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createWorkManifest, saveRuntimeStateSnapshot, saveWorkManifest, type CurrentStateFact } from "@actalk/inkos-core";
import { createStudioServer } from "../api/server.js";
import { manuscriptHref } from "../pages/Publish.js";

const fact = (subject: string, predicate: string, object: string, from: number): CurrentStateFact =>
  ({ subject, predicate, object, validFromChapter: from, validUntilChapter: null, sourceChapter: from });
const snapshot = (facts: CurrentStateFact[]) => ({
  manifest: { schemaVersion: 2 as const, language: "en" as const, lastAppliedChapter: 2, projectionVersion: 1 },
  currentState: { chapter: 2, facts },
  hooks: { hooks: [] },
  chapterSummaries: { rows: [{ chapter: 1, title: "The Gate", characters: "Nell", events: "Nell reaches the gate.", stateChanges: "", hookActivity: "", mood: "calm", chapterType: "setup" }] },
});

describe("plotlint exports and branches in Studio", () => {
  let root: string;
  let state: StateManager;
  const app = () => createStudioServer({} as never, root);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-publish-"));
    state = new StateManager(root);
    await saveWorkManifest(root, createWorkManifest({ id: "fen", title: "Fen", profileId: "longform-novel", language: "en" }));
    await mkdir(join(state.bookDir("fen"), "chapters"), { recursive: true });
    await writeFile(join(state.bookDir("fen"), "chapters", "0001_a.md"), "# Chapter 1: The Gate\n\nNell ran.\n");
    await writeFile(join(state.bookDir("fen"), "chapters", "0002_b.md"), "# Chapter 2\n\nPell lived on.\n");
    await saveRuntimeStateSnapshot(state.bookDir("fen"), snapshot([fact("Pell", "status", "alive", 2)]));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("downloads the manuscript, outline and provenance report", async () => {
    expect((await app().request("/api/v1/plotlint/export/fen/manuscript")).status).toBe(400);
    const href = manuscriptHref("fen", "Cob Example", "", "cob@example.com\n\n");
    expect(href).toBe("/api/v1/plotlint/export/fen/manuscript?author=Cob+Example&contact=cob%40example.com");
    const manuscript = await app().request(href);
    expect(manuscript.status).toBe(200);
    expect(manuscript.headers.get("Content-Disposition")).toContain("fen-manuscript.docx");
    expect(Buffer.from(await manuscript.arrayBuffer()).subarray(0, 2).toString()).toBe("PK");
    expect(await (await app().request("/api/v1/plotlint/export/fen/outline")).text()).toContain("## Chapter 1: The Gate");
    expect(await (await app().request("/api/v1/plotlint/export/fen/provenance")).text()).toContain("# Provenance report");
  });

  it("creates a branch and compares it with the main line", async () => {
    const post = (name: unknown) => app().request("/api/v1/plotlint/branches/fen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    expect((await post("Bad Name")).status).toBe(400);
    expect(await (await post("pell-drowns")).json()).toEqual({ id: "fen--pell-drowns" });
    expect((await (await app().request("/api/v1/plotlint/branches/fen")).json()).branches.map((b: { name: string }) => b.name)).toEqual(["pell-drowns"]);

    const branchDir = state.bookDir("fen--pell-drowns");
    await writeFile(join(branchDir, "chapters", "0002_b.md"), "# Chapter 2\n\nPell drowned in the race.\n");
    await saveRuntimeStateSnapshot(branchDir, snapshot([fact("Pell", "status", "dead", 2)]));
    const diff = await (await app().request("/api/v1/plotlint/branches/fen/pell-drowns/diff")).json();
    expect(diff.chapters).toEqual([{ chapter: 2, status: "changed", wordsAdded: 4, wordsRemoved: 2 }]);
    expect(diff.facts).toEqual([{ subject: "Pell", predicate: "status", main: "alive", branch: "dead" }]);
    expect((await app().request("/api/v1/plotlint/branches/fen/nope/diff")).status).toBe(400);
  });
});
