import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createWorkManifest, saveRuntimeStateSnapshot, saveWorkManifest } from "@actalk/inkos-core";
import { appendVerdicts } from "@plotlint/diagnostics/node";
import { studyReport, verdictOfAction, verdictStats, type Verdict, type VerdictAction } from "@plotlint/diagnostics/verdicts";
import {
  formatStudyTable,
  layerOfRuleId,
  outcomeLine,
  parseMinVerdicts,
  parseRejectAbove,
  parseVerdictAction,
  parseVerdictKind,
} from "../commands/lint-study.js";

let clock = 0;
const verdict = (ruleId: string, fingerprint: string, action: VerdictAction): Verdict => ({
  ruleId, fingerprint, verdict: verdictOfAction(action), action,
  at: new Date(Date.UTC(2026, 9, 27, 0, 0, clock++)).toISOString(), layer: "style", confidence: "deterministic",
});
const many = (ruleId: string, accepted: number, rejected: number) => [
  ...Array.from({ length: accepted }, (_, i) => verdict(ruleId, `${ruleId}-a${i}`, "fix")),
  ...Array.from({ length: rejected }, (_, i) => verdict(ruleId, `${ruleId}-r${i}`, "not-useful")),
];

describe("lint study parsing", () => {
  it("parses --min and --reject-above", () => {
    expect(parseMinVerdicts(undefined)).toBe(20);
    expect(parseMinVerdicts("5")).toBe(5);
    for (const bad of ["0", "-1", "2.5", "x"]) expect(() => parseMinVerdicts(bad)).toThrow(/--min/);
    expect(parseRejectAbove(undefined)).toBe(0.5);
    expect(parseRejectAbove(".4")).toBe(0.4);
    for (const bad of ["1", "1.5", "-0.1", "half"]) expect(() => parseRejectAbove(bad)).toThrow(/--reject-above/);
  });

  it("parses verdicts and actions, refusing ones that disagree", () => {
    expect(parseVerdictKind("accept")).toBe("accepted");
    expect(parseVerdictKind("Reject")).toBe("rejected");
    expect(() => parseVerdictKind("maybe")).toThrow(/accept or reject/);
    expect(parseVerdictAction("accepted", undefined)).toBe("edited");
    expect(parseVerdictAction("rejected", undefined)).toBe("dismissed");
    expect(parseVerdictAction("accepted", "fix")).toBe("fix");
    expect(parseVerdictAction("rejected", "not-useful")).toBe("not-useful");
    expect(() => parseVerdictAction("accepted", "intentional")).toThrow(/cannot go with accept/);
    expect(() => parseVerdictAction("rejected", "shrug")).toThrow(/--action/);
  });

  it("reads the layer from a rule id", () => {
    expect(layerOfRuleId("style/general.Cliches")).toBe("style");
    expect(layerOfRuleId("continuity/dead-entity-acts")).toBe("continuity");
    expect(() => layerOfRuleId("cliches")).toThrow(/<layer>\/<name>/);
  });

  it("formats the gate table with a verdict line per check", () => {
    const decisions = studyReport([verdictStats([...many("style/cliche", 2, 20), ...many("style/filter", 20, 2), ...many("style/rare", 1, 1)])]);
    const lines = formatStudyTable(decisions);
    expect(lines[0]).toMatch(/^check\s+n\s+accept\s+reject \(95% CI\)\s+verdict$/u);
    expect(lines[1]).toMatch(/^style\/cliche\s+22\s+9%\s+91% \(72%-97%\)\s+turn off by default \(rejected > 50%\)$/u);
    expect(lines[2]).toMatch(/^style\/filter\s+22\s+91%\s+9% .*stays on$/u);
    expect(lines[3]).toMatch(/^style\/rare\s+2\s+50%.*not enough data$/u);
    expect(outcomeLine({ outcome: "stays-on" })).toBe("stays on");
  });
});

const testDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(testDir, "..", "..", "dist", "index.js");

describe("inkos lint study and verdict", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-study-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  const run = (args: string[]) => execFileSync("node", [cliEntry, ...args], {
    cwd: projectDir,
    encoding: "utf-8",
    timeout: 15_000,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INKOS_"))), HOME: projectDir },
  });

  const book = async (id: string) => {
    await saveWorkManifest(projectDir, createWorkManifest({ id, title: id, profileId: "longform-novel", language: "en" }));
    return new StateManager(projectDir).bookDir(id);
  };

  it("records verdicts by fingerprint and reports them per book and pooled", async () => {
    run(["init"]);
    const bookDir = await book("study-one");
    const fact = (subject: string, predicate: string, object: string, chapter: number) => ({
      subject, predicate, object, validFromChapter: chapter, validUntilChapter: null, sourceChapter: chapter,
    });
    await saveRuntimeStateSnapshot(bookDir, {
      manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 3, projectionVersion: 1 },
      currentState: { chapter: 3, facts: [fact("Mira", "status", "dead", 2), fact("Mira", "location", "harbour", 3)] },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [] },
    });
    const linted = JSON.parse(run(["lint", "study-one", "--json"])) as { books: Array<{ diagnostics: Array<{ ruleId: string; fingerprint: string }> }> };
    const finding = linted.books[0]!.diagnostics[0]!;

    const recorded = JSON.parse(run(["lint", "verdict", "reject", finding.fingerprint, "study-one", "--action", "intentional", "--json"]));
    expect(recorded.verdict).toMatchObject({ ruleId: finding.ruleId, fingerprint: finding.fingerprint, verdict: "rejected", action: "intentional", layer: "continuity" });
    expect(run(["lint", "verdict", "accept", finding.fingerprint, "study-one"])).toContain("Recorded accepted (edited)");
    // A finding already fixed is no longer in the book; --rule records it anyway.
    run(["lint", "verdict", "accept", "0000000000000000", "study-one", "--rule", "style/general.Cliches", "--chapter", "3"]);
    expect(() => run(["lint", "verdict", "accept", "0000000000000000", "study-one"])).toThrow();
    const lines = (await readFile(join(bookDir, "story", "plotlint", "verdicts.jsonl"), "utf-8")).trim().split("\n");
    expect(lines).toHaveLength(3);

    const one = JSON.parse(run(["lint", "study", "study-one", "--json", "--min", "1"]));
    // The writer changed their mind: the later accept stands.
    expect(one.checks.find((row: { ruleId: string }) => row.ruleId === finding.ruleId)).toMatchObject({ accepted: 1, rejected: 0, n: 1, outcome: "stays-on" });

    const other = await book("study-two");
    await appendVerdicts(other, many("style/general.Cliches", 1, 25));
    const pooled = JSON.parse(run(["lint", "study", "--all", "--json"]));
    expect(pooled.books.map((entry: { id: string }) => entry.id).sort()).toEqual(["study-one", "study-two"]);
    expect(pooled.offByDefault).toEqual(["style/general.Cliches"]);
    expect(pooled.checks.find((row: { ruleId: string }) => row.ruleId === "style/general.Cliches")).toMatchObject({ n: 27, accepted: 2, books: 2 });
    const text = run(["lint", "study", "--all"]);
    expect(text).toContain("turn off by default (rejected > 50%)");
    expect(text).toContain("not enough data");
    expect(run(["lint", "study", "study-two"])).toContain(`Lowered to off in "study-two" by the author's verdicts: style/general.Cliches`);
  });
});
