import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, saveRuntimeStateSnapshot, type CurrentStateFact } from "@actalk/inkos-core";
import { createStudioServer } from "../api/server.js";

const fact = (subject: string, predicate: string, object: string, from: number): CurrentStateFact =>
  ({ subject, predicate, object, validFromChapter: from, validUntilChapter: null, sourceChapter: from });

describe("plotlint series in Studio", () => {
  let root: string;
  const text = "# Chapter 2\n\nPell stood on the quay.\n";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-series-"));
    const state = new StateManager(root);
    for (const [id, facts] of [["one", [fact("Pell", "status", "dead", 9)]], ["two", [fact("Pell", "location", "the quay", 2)]]] as const) {
      const bookDir = state.bookDir(id);
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await writeFile(join(bookDir, "chapters", "0002_b.md"), text);
      await saveRuntimeStateSnapshot(bookDir, {
        manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 9, projectionVersion: 1 },
        currentState: { chapter: 9, facts: [...facts] },
        hooks: { hooks: [] },
        chapterSummaries: { rows: [] },
      });
    }
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const lint = async () => (await (await createStudioServer({} as never, root).request("/api/v1/plotlint/lint", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId: "two", chapter: 2, text }),
  })).json()) as { diagnostics: Array<{ ruleId: string; summary: string }> };

  it("checks a book against the book before it once series.json names it", async () => {
    expect((await lint()).diagnostics.some((d) => d.ruleId === "continuity/dead-entity-acts")).toBe(false);
    const plotlint = join(new StateManager(root).bookDir("two"), "story", "plotlint");
    await mkdir(plotlint, { recursive: true });
    await writeFile(join(plotlint, "series.json"), JSON.stringify({ version: 1, after: ["one"] }));
    const found = (await lint()).diagnostics.find((d) => d.ruleId === "continuity/dead-entity-acts");
    expect(found?.summary).toContain("dead since one");
  });
});
