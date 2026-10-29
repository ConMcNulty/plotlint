import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createWorkManifest, saveRuntimeStateSnapshot, saveWorkManifest, type CurrentStateFact } from "@actalk/inkos-core";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(testDir, "..", "..", "dist", "index.js");

const fact = (subject: string, predicate: string, object: string, from: number): CurrentStateFact =>
  ({ subject, predicate, object, validFromChapter: from, validUntilChapter: null, sourceChapter: from });

describe("inkos lint series", () => {
  let projectDir: string;
  const env = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INKOS_"))), HOME: projectDir });
  const inkos = (...args: string[]) => {
    try {
      return { stdout: execFileSync("node", [cliEntry, ...args], { cwd: projectDir, env: env(), encoding: "utf-8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
    } catch (error) {
      const failed = error as { stdout: string; stderr: string; status: number };
      return { stdout: `${failed.stdout}${failed.stderr}`, code: failed.status };
    }
  };

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-series-"));
    inkos("init");
    const state = new StateManager(projectDir);
    const books: Array<[string, string, CurrentStateFact[]]> = [
      ["one", "Still Water", [fact("Pell", "status", "dead", 12)]],
      ["two", "Low Tide", [fact("Pell", "location", "the quay", 2)]],
    ];
    for (const [id, title, facts] of books) {
      await saveWorkManifest(projectDir, createWorkManifest({ id, title, profileId: "longform-novel", language: "en" }));
      const bookDir = state.bookDir(id);
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await writeFile(join(bookDir, "chapters", "0001_a.md"), "# Chapter 1\n\nThe tide turned.\n");
      await saveRuntimeStateSnapshot(bookDir, {
        manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 12, projectionVersion: 1 },
        currentState: { chapter: 12, facts },
        hooks: { hooks: [] },
        chapterSummaries: { rows: [] },
      });
    }
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("checks a book against the end of the book before it", () => {
    expect(inkos("lint", "series", "two").stdout).toContain("not in a series");
    expect(inkos("lint", "series", "two", "--after", "nope").code).toBe(1);
    const set = inkos("lint", "series", "two", "--after", "one");
    expect(set.stdout).toContain("two follows Still Water (one)");
    expect(set.stdout).toContain("Pell · status · dead (ch12)");
    const lint = inkos("lint", "two", "--layers", "continuity", "--json");
    expect(lint.stdout).toContain("continuity/dead-entity-acts");
    expect(lint.stdout).toContain("dead since Still Water");
    // Book one alone is clean.
    expect(inkos("lint", "one", "--layers", "continuity", "--json").stdout).not.toContain("dead-entity-acts");
  }, 90_000);

  it("leaves the series with an empty --after", async () => {
    inkos("lint", "series", "two", "--after", "one");
    inkos("lint", "series", "two", "--after", "");
    const file = JSON.parse(await readFile(join(new StateManager(projectDir).bookDir("two"), "story", "plotlint", "series.json"), "utf-8"));
    expect(file.after).toEqual([]);
    expect(inkos("lint", "two", "--layers", "continuity", "--json").stdout).not.toContain("dead-entity-acts");
  }, 90_000);
});
