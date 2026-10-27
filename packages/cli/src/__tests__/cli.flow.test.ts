import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createWorkManifest, saveRuntimeStateSnapshot, saveWorkManifest } from "@actalk/inkos-core";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(testDir, "..", "..", "dist", "index.js");

describe("CLI mini-flows", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-flow-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("initializes a project and round-trips structured configuration", async () => {
    run(["init"]);
    run(["config", "set", "llm.provider", "anthropic"]);
    const shown = JSON.parse(run(["config", "show"]));

    expect({
      provider: shown.llm.provider,
      worksDirectory: (await stat(join(projectDir, "works"))).isDirectory(),
      nodeVersion: (await readFile(join(projectDir, ".node-version"), "utf-8")).trim(),
    }).toEqual({
      provider: "anthropic",
      worksDirectory: true,
      nodeVersion: "22",
    });
  });

  it("lists and inspects canonical Works through one surface", async () => {
    run(["init"]);
    await saveWorkManifest(projectDir, createWorkManifest({
      id: "cli-script",
      title: "CLI Script",
      profileId: "script",
      language: "en",
    }));

    const listed = JSON.parse(run(["work", "list", "--json"])) as {
      works: Array<{ id: string; profileId: string }>;
    };
    const shown = JSON.parse(run(["work", "show", "cli-script", "--json"])) as {
      work: { id: string; profileId: string };
      episodes: unknown[];
    };

    expect({
      listed: listed.works.map((work) => [work.id, work.profileId]),
      shown: [shown.work.id, shown.work.profileId],
      episodeCount: shown.episodes.length,
    }).toEqual({
      listed: [["cli-script", "script"]],
      shown: ["cli-script", "script"],
      episodeCount: 0,
    });
  });

  it("lints a book's runtime state and reports a dead character who acts", async () => {
    run(["init"]);
    await saveWorkManifest(projectDir, createWorkManifest({
      id: "lint-novel",
      title: "Lint Novel",
      profileId: "longform-novel",
      language: "en",
    }));
    const fact = (subject: string, predicate: string, object: string, chapter: number) => ({
      subject, predicate, object, validFromChapter: chapter, validUntilChapter: null, sourceChapter: chapter,
    });
    await saveRuntimeStateSnapshot(new StateManager(projectDir).bookDir("lint-novel"), {
      manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 3, projectionVersion: 1 },
      currentState: { chapter: 3, facts: [fact("Mira", "status", "dead", 2), fact("Mira", "location", "harbour", 3)] },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [] },
    });

    const linted = JSON.parse(run(["lint", "lint-novel", "--json"])) as {
      books: Array<{ id: string; diagnostics: Array<{ ruleId: string; chapter: number; severity: string }> }>;
    };

    expect(linted.books[0]!.diagnostics.map((d) => [d.ruleId, d.chapter, d.severity])).toEqual([
      ["continuity/dead-entity-acts", 3, "warning"],
    ]);
    expect(run(["lint", "lint-novel"])).toContain("ch3 warning continuity/dead-entity-acts [extracted]");
  });

  it("suppresses lint findings per instance and per rule, saved in the book", async () => {
    run(["init"]);
    await saveWorkManifest(projectDir, createWorkManifest({
      id: "lint-novel",
      title: "Lint Novel",
      profileId: "longform-novel",
      language: "en",
    }));
    const fact = (subject: string, predicate: string, object: string, chapter: number) => ({
      subject, predicate, object, validFromChapter: chapter, validUntilChapter: null, sourceChapter: chapter,
    });
    const bookDir = new StateManager(projectDir).bookDir("lint-novel");
    await saveRuntimeStateSnapshot(bookDir, {
      manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 4, projectionVersion: 1 },
      currentState: {
        chapter: 4,
        facts: [fact("Mira", "status", "dead", 2), fact("Mira", "location", "harbour", 3), fact("Mira", "holds", "lamp", 4)],
      },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [] },
    });
    type Lint = {
      books: Array<{
        diagnostics: Array<{ chapter: number; fingerprint: string }>;
        suppressed: Array<{ diagnostic: { chapter: number }; suppression: { kind: string; reason: string } }>;
      }>;
    };
    const lint = () => (JSON.parse(run(["lint", "lint-novel", "--json"])) as Lint).books[0]!;

    const before = lint();
    expect(before.diagnostics.map((d) => d.chapter)).toEqual([3, 4]);
    const fingerprint = before.diagnostics[0]!.fingerprint;
    expect(run(["lint", "lint-novel", "--verbose"])).toContain(`(${fingerprint})`);

    run(["lint", "suppress", "continuity/dead-entity-acts", "lint-novel", "--reason", "flashback", "--fingerprint", fingerprint]);
    const saved = JSON.parse(await readFile(join(bookDir, "story", "plotlint", "suppressions.json"), "utf-8"));
    expect(saved).toMatchObject({
      version: 1,
      suppressions: [{ kind: "instance", ruleId: "continuity/dead-entity-acts", fingerprint, reason: "flashback", chapter: 3 }],
    });
    const afterInstance = lint();
    expect(afterInstance.diagnostics.map((d) => d.chapter)).toEqual([4]);
    expect(afterInstance.suppressed.map((s) => [s.diagnostic.chapter, s.suppression.reason])).toEqual([[3, "flashback"]]);
    expect(run(["lint", "lint-novel"])).toContain("1 suppressed (--show-suppressed to list)");
    expect(run(["lint", "lint-novel", "--show-suppressed"])).toContain("[suppressed: flashback] ch3 warning");

    run(["lint", "suppress", "continuity/dead-entity-acts", "--reason", "ghost story"]);
    const afterRule = lint();
    expect(afterRule.diagnostics).toEqual([]);
    expect(afterRule.suppressed.map((s) => [s.diagnostic.chapter, s.suppression.kind])).toEqual([[3, "instance"], [4, "rule"]]);
    expect(run(["lint", "lint-novel"])).toContain("2 suppressed");

    run(["lint", "unsuppress", "continuity/dead-entity-acts"]);
    expect(lint().diagnostics.map((d) => d.chapter)).toEqual([4]);
    const unsuppressed = JSON.parse(run(["lint", "unsuppress", "continuity/dead-entity-acts", "lint-novel", "--fingerprint", fingerprint, "--json"]));
    expect(unsuppressed.removed.map((s: { kind: string }) => s.kind)).toEqual(["instance"]);
    expect(lint().suppressed).toEqual([]);
    expect(() => run(["lint", "suppress", "continuity/dead-entity-acts", "--reason", "x", "--fingerprint", "0000000000000000"]))
      .toThrow(/No continuity\/dead-entity-acts finding/);
  }, 120_000);

  function run(args: string[]): string {
    return execFileSync("node", [cliEntry, ...args], {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 15_000,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INKOS_"))),
        HOME: projectDir,
      },
    });
  }
});
