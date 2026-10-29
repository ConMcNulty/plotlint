import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createWorkManifest, loadRuntimeStateSnapshot, saveRuntimeStateSnapshot, saveWorkManifest, type CurrentStateFact } from "@actalk/inkos-core";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(testDir, "..", "..", "dist", "index.js");

const fact = (subject: string, predicate: string, object: string, from: number): CurrentStateFact =>
  ({ subject, predicate, object, validFromChapter: from, validUntilChapter: null, sourceChapter: from });
const snapshot = (facts: CurrentStateFact[]) => ({
  manifest: { schemaVersion: 2 as const, language: "en" as const, lastAppliedChapter: 2, projectionVersion: 1 },
  currentState: { chapter: 2, facts },
  hooks: { hooks: [] },
  chapterSummaries: { rows: [] },
});

describe("inkos lint branch", () => {
  let projectDir: string;
  let state: StateManager;
  const env = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INKOS_"))), HOME: projectDir });
  const inkos = (...args: string[]) => {
    try {
      return { stdout: execFileSync("node", [cliEntry, "lint", "branch", ...args], { cwd: projectDir, env: env(), encoding: "utf-8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
    } catch (error) {
      const failed = error as { stdout: string; stderr: string; status: number };
      return { stdout: `${failed.stdout}${failed.stderr}`, code: failed.status };
    }
  };

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-branch-"));
    execFileSync("node", [cliEntry, "init"], { cwd: projectDir, env: env(), encoding: "utf-8", timeout: 15_000 });
    await saveWorkManifest(projectDir, createWorkManifest({ id: "fen", title: "Fen", profileId: "longform-novel", language: "en" }));
    state = new StateManager(projectDir);
    await mkdir(join(state.bookDir("fen"), "chapters"), { recursive: true });
    await writeFile(join(state.bookDir("fen"), "chapters", "0001_a.md"), "# Chapter 1\n\nNell ran.\n");
    await writeFile(join(state.bookDir("fen"), "chapters", "0002_b.md"), "# Chapter 2\n\nPell lived on.\n");
    await saveRuntimeStateSnapshot(state.bookDir("fen"), snapshot([fact("Pell", "status", "alive", 2)]));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("creates a branch as its own book, diffs it, and adopts it keeping the old line", async () => {
    expect(inkos("create", "Bad Name", "fen").code).toBe(1);
    expect(inkos("create", "pell-drowns", "fen").stdout).toContain("branched fen as fen--pell-drowns");
    expect(inkos("create", "pell-drowns", "fen").code).toBe(1);
    const manifest = JSON.parse(await readFile(join(projectDir, "works", "fen--pell-drowns", "work.json"), "utf-8"));
    expect(manifest).toMatchObject({ id: "fen--pell-drowns", title: "Fen (pell-drowns)", metadata: { plotlintBranchOf: "fen", plotlintBranch: "pell-drowns" } });

    const branchDir = state.bookDir("fen--pell-drowns");
    await writeFile(join(branchDir, "chapters", "0002_b.md"), "# Chapter 2\n\nPell drowned in the race.\n");
    await saveRuntimeStateSnapshot(branchDir, snapshot([fact("Pell", "status", "dead", 2)]));

    expect(inkos("list", "fen").stdout).toContain("pell-drowns");
    const diff = inkos("diff", "pell-drowns", "fen");
    expect(diff.stdout).toContain("ch2 +4 −2 words");
    expect(diff.stdout).toContain("Pell · status: alive → dead");

    expect(inkos("adopt", "pell-drowns", "fen").code).toBe(1);
    const adopt = inkos("adopt", "pell-drowns", "fen", "--yes");
    expect(adopt.code).toBe(0);
    expect(await readFile(join(state.bookDir("fen"), "chapters", "0002_b.md"), "utf-8")).toContain("Pell drowned");
    expect((await loadRuntimeStateSnapshot(state.bookDir("fen"))).currentState.facts[0]!.object).toBe("dead");
    const kept = JSON.parse(inkos("list", "fen", "--json").stdout).branches.find((entry: { name: string }) => entry.name.startsWith("before-pell-drowns-"));
    expect(await readFile(join(state.bookDir(kept.id), "chapters", "0002_b.md"), "utf-8")).toContain("Pell lived on.");
  }, 90_000);
});
