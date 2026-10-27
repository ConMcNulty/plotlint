import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

  it("applies the book's rules.json and frames.json, and lists the rules", async () => {
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
      currentState: { chapter: 4, facts: [fact("Mira", "status", "dead", 2), fact("Mira", "location", "harbour", 3), fact("Mira", "holds", "key", 4)] },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [] },
    });
    const plotlint = join(bookDir, "story", "plotlint");
    await mkdir(plotlint, { recursive: true });
    await writeFile(join(plotlint, "rules.json"), JSON.stringify({ version: 1, rules: { "continuity/dead-entity-acts": "error" } }));
    await writeFile(join(plotlint, "frames.json"), JSON.stringify({ version: 1, frames: [{ chapter: 3, frame: "flashback" }] }));

    const linted = JSON.parse(runWithStatus(["lint", "lint-novel", "--json"]).stdout) as {
      books: Array<{ diagnostics: Array<{ ruleId: string; chapter: number; severity: string }> }>;
    };
    // Chapter 3 is a flashback, so only chapter 4's fact counts, at the configured severity.
    expect(linted.books[0]!.diagnostics.map((d) => [d.ruleId, d.chapter, d.severity])).toEqual([
      ["continuity/dead-entity-acts", 4, "error"],
    ]);

    const rules = JSON.parse(run(["lint", "rules", "lint-novel", "--json"])) as { rules: Array<{ id: string; enabled: boolean; severity?: string }> };
    expect(rules.rules.find((rule) => rule.id === "continuity/dead-entity-acts")).toMatchObject({ enabled: true, severity: "error" });
    expect(rules.rules.map((rule) => rule.id)).toContain("continuity/dead-then-alive");
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

  it("reports the evidence gate: fact ops whose quoted passage is still in the chapter", async () => {
    run(["init"]);
    await saveWorkManifest(projectDir, createWorkManifest({
      id: "lint-novel",
      title: "Lint Novel",
      profileId: "longform-novel",
      language: "en",
    }));
    const bookDir = new StateManager(projectDir).bookDir("lint-novel");
    const ch1 = "Mira reached the harbour at dusk. She lit the lamp.\n\nLater she hid in the chapel crypt.\n";
    const cite = (quote: string) => ({ quote, start: ch1.indexOf(quote), end: ch1.indexOf(quote) + quote.length });
    await saveRuntimeStateSnapshot(bookDir, {
      manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 2, projectionVersion: 1 },
      currentState: {
        chapter: 2,
        facts: [
          { subject: "Mira", predicate: "location", object: "harbour", validFromChapter: 1, validUntilChapter: null, sourceChapter: 1,
            kind: "location", evidence: cite("Mira reached the harbour") },
          // Quoted with a capital S; the chapter reads "she hid".
          { subject: "Mira", predicate: "hiding in", object: "the chapel crypt", validFromChapter: 1, validUntilChapter: null, sourceChapter: 1,
            kind: "location", evidence: { quote: "She hid in the chapel crypt" } },
          { subject: "Mira", predicate: "holds", object: "lamp", validFromChapter: 1, validUntilChapter: 1, sourceChapter: 1,
            kind: "possession", evidence: cite("She lit the lamp"), endEvidence: { quote: "The lamp went out." } },
          { subject: "Tomas", predicate: "mood", object: "calm", validFromChapter: 2, validUntilChapter: null, sourceChapter: 2 },
        ],
      },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [] },
    });
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0001_harbour.md"), `# Chapter 1: Harbour\n\n${ch1}`);
    await writeFile(join(bookDir, "chapters", "0002_night.md"), "# Chapter 2: Night\n\nTomas sat by the fire, calm.\n");

    // Below the default 95% gate: the command fails but still prints the report.
    const failed = runWithStatus(["lint", "evidence", "lint-novel", "--json"]);
    expect(failed.status).toBe(1);
    const coverage = JSON.parse(failed.stdout) as {
      bookId: string; min: number; passed: boolean; total: number; valid: number; ratio: number;
      byChapter: Array<{ chapter: number; total: number; valid: number }>;
      issues: Array<{ op: string; status: string; chapter: number; fact: { predicate: string } }>;
    };
    expect(coverage).toMatchObject({
      bookId: "lint-novel", min: 0.95, passed: false, total: 5, valid: 3, ratio: 0.6,
      byChapter: [{ chapter: 1, total: 3, valid: 3 }, { chapter: 2, total: 2, valid: 0 }],
    });
    expect(coverage.issues.map((issue) => [issue.status, issue.chapter, issue.op, issue.fact.predicate])).toEqual([
      ["not-found", 2, "expire", "holds"],
      ["uncited", 2, "upsert", "mood"],
    ]);

    const text = runWithStatus(["lint", "evidence"]);
    expect(text.status).toBe(1);
    expect(text.stdout).toContain("lint-novel: 3/5 fact ops have a valid evidence span (60.0%), below the 95.0% gate");
    expect(text.stdout).toContain("  chapter  valid  total   ratio\n  ch1          3      3  100.0%\n  ch2          0      2    0.0%\n");
    expect(text.stdout).toContain("not-found ch2 expire: Mira · holds · lamp \"The lamp went out.\"");
    expect(text.stdout).toContain("uncited ch2 upsert: Tomas · mood · calm");

    expect(run(["lint", "evidence", "--min", "0.6"])).toContain("meets the 60.0% gate");
    expect(() => run(["lint", "evidence", "--min", "1.5"])).toThrow(/--min takes a ratio/);

    // Rules cite facts with their kind and evidence; a kind-labelled location counts.
    const linted = JSON.parse(run(["lint", "lint-novel", "--json", "--layers", "continuity"])) as {
      books: Array<{ diagnostics: Array<{ ruleId: string; facts: Array<{ predicate: string; kind?: string; evidence?: { quote: string } }> }> }>;
    };
    expect(linted.books[0]!.diagnostics.map((d) => [d.ruleId, d.facts.map((fact) => [fact.predicate, fact.kind, fact.evidence?.quote])])).toEqual([
      ["continuity/two-places-at-once", [["location", "location", "Mira reached the harbour"], ["hiding in", "location", "She hid in the chapel crypt"]]],
    ]);
  }, 120_000);

  it("lints chapter text with L0 mechanics and L1 style, at compiler-style positions", async () => {
    run(["init"]);
    await saveWorkManifest(projectDir, createWorkManifest({
      id: "lint-novel",
      title: "Lint Novel",
      profileId: "longform-novel",
      language: "en",
    }));
    const bookDir = new StateManager(projectDir).bookDir("lint-novel");
    // "Zorvane" only passes the spelling check because story state names it.
    await saveRuntimeStateSnapshot(bookDir, {
      manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 1, projectionVersion: 1 },
      currentState: {
        chapter: 1,
        facts: [{ subject: "Zorvane", predicate: "location", object: "harbour", validFromChapter: 1, validUntilChapter: null, sourceChapter: 1 }],
      },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [] },
    });
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0001_harbour.md"), "Zorvane walked down to the water.\nShe felt the wind and lit teh lamp.\n");
    await writeFile(join(bookDir, "chapters", "0002_deng.md"), "她看见了港口的灯，风很冷。\n");
    type Lint = {
      books: Array<{
        chapters: number[];
        diagnostics: Array<{
          ruleId: string; layer: string; severity: string; chapter: number; fingerprint: string;
          range: { sourceId: string; start: number; end: number }; location: { line: number; column: number };
        }>;
        suppressed: Array<{ diagnostic: { ruleId: string } }>;
      }>;
    };
    const lint = (...args: string[]) => (JSON.parse(run(["lint", "lint-novel", "--json", ...args])) as Lint).books[0]!;

    const all = lint();
    expect(all.chapters).toEqual([1, 2]);
    // The Chinese chapter produces nothing: both layers are English-only.
    expect(all.diagnostics.map((d) => [d.ruleId, d.layer, d.severity, d.chapter, d.range, d.location])).toEqual([
      ["style/general.FilterWords", "style", "note", 1, { sourceId: "chapter:1", start: 38, end: 42 }, { line: 2, column: 5 }],
      ["mechanics/harper", "mechanics", "warning", 1, { sourceId: "chapter:1", start: 60, end: 63 }, { line: 2, column: 27 }],
    ]);
    const text = run(["lint", "lint-novel"]);
    expect(text).toContain("ch1:2:5 note style/general.FilterWords [deterministic]");
    expect(text).toContain("ch1:2:27 warning mechanics/harper [deterministic]");

    expect(lint("--layers", "style").diagnostics.map((d) => d.ruleId)).toEqual(["style/general.FilterWords"]);
    expect(lint("--layers", "continuity").diagnostics).toEqual([]);
    expect(lint("--chapter", "2")).toMatchObject({ chapters: [2], diagnostics: [] });
    expect(() => run(["lint", "--layers", "spelling"])).toThrow(/--layers takes/);

    const typo = all.diagnostics.find((d) => d.ruleId === "mechanics/harper")!;
    run(["lint", "suppress", "mechanics/harper", "--reason", "dialect spelling", "--fingerprint", typo.fingerprint]);
    const afterSuppress = lint();
    expect(afterSuppress.diagnostics.map((d) => d.ruleId)).toEqual(["style/general.FilterWords"]);
    expect(afterSuppress.suppressed.map((s) => s.diagnostic.ruleId)).toEqual(["mechanics/harper"]);
    expect(run(["lint", "lint-novel"])).not.toContain("mechanics/harper");
  }, 120_000);

  it("adds, approves, lists and removes author-written invariants, and lints approved ones", async () => {
    run(["init"]);
    await saveWorkManifest(projectDir, createWorkManifest({
      id: "lint-novel",
      title: "Lint Novel",
      profileId: "longform-novel",
      language: "en",
    }));
    const bookDir = new StateManager(projectDir).bookDir("lint-novel");
    await saveRuntimeStateSnapshot(bookDir, {
      manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 3, projectionVersion: 1 },
      currentState: {
        chapter: 3,
        facts: [{ subject: "Mira", predicate: "knows", object: "Captain Voss is her father", validFromChapter: 2, validUntilChapter: null, sourceChapter: 2 }],
      },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [] },
    });
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0001_door.md"), "# Chapter 1\n\nThe door held.\nShe was inside the vault at last.\n");
    await writeFile(join(bookDir, "chapters", "0003_end.md"), "# Chapter 3\n\nInside the vault, gold.\n");
    type Lint = { books: Array<{ proposedInvariants: number; diagnostics: Array<{ ruleId: string; code: string; severity: string; chapter: number; location?: { line: number; column: number } }> }> };
    const lint = () => (JSON.parse(runWithStatus(["lint", "lint-novel", "--json", "--layers", "continuity"]).stdout) as Lint).books[0]!;

    const added = JSON.parse(run(["lint", "invariant", "add", "Mira must not learn the captain's identity before chapter 20", "--id", "mira-captain-identity", "--json",
      "--check", JSON.stringify({ kind: "not-before", fact: { subject: "Mira", kind: "knowledge", object: { contains: ["captain"] } }, chapter: 20 })])) as {
      invariant: { id: string; status: string; explanation: string };
    };
    expect(added.invariant).toMatchObject({
      id: "mira-captain-identity",
      status: "proposed",
      explanation: "Fails when a fact whose subject is \"Mira\", of kind knowledge and whose object contains \"captain\" is in force before chapter 20.",
    });
    const vault = run(["lint", "invariant", "add", "the reader never sees inside the vault until the finale",
      "--check", JSON.stringify({ kind: "text-not-before", text: { contains: ["inside the vault"] }, chapter: "last" })]);
    expect(vault).toContain("the-reader-never-sees-inside-the-vault-until-the  proposed");
    expect(vault).toContain("inkos lint invariant approve the-reader-never-sees-inside-the-vault-until-the");
    expect(run(["lint", "invariant", "add", "Tomas never lies", "--check", JSON.stringify({ kind: "unsupported", reason: "Lying is a judgment." })]))
      .toContain("tomas-never-lies  unsupported");
    expect(() => run(["lint", "invariant", "add", "x", "--check", "{\"kind\":\"never\",\"fact\":{}}"])).toThrow(/not a valid check/);

    // Proposed invariants do not run.
    expect(lint()).toMatchObject({ proposedInvariants: 2, diagnostics: [] });
    expect(run(["lint", "lint-novel"])).toContain("2 proposed invariants not yet approved");

    run(["lint", "invariant", "approve", "mira-captain-identity"]);
    run(["lint", "invariant", "approve", "the-reader-never-sees-inside-the-vault-until-the", "lint-novel"]);
    expect(() => run(["lint", "invariant", "approve", "tomas-never-lies"])).toThrow(/cannot be checked deterministically/);
    expect(() => run(["lint", "invariant", "approve", "nope"])).toThrow(/No invariant "nope"/);

    const after = lint();
    expect(after.diagnostics.map((d) => [d.ruleId, d.code, d.severity, d.chapter, d.location])).toEqual([
      ["continuity/invariant", "the-reader-never-sees-inside-the-vault-until-the", "error", 1, { line: 4, column: 9 }],
      ["continuity/invariant", "mira-captain-identity", "error", 2, undefined],
    ]);
    const text = runWithStatus(["lint", "lint-novel", "--layers", "continuity"]);
    expect(text.status).toBe(1);
    expect(text.stdout).toContain("ch2 error continuity/invariant [extracted]: Invariant \"Mira must not learn the captain's identity before chapter 20\" fails in chapter 2");
    expect(text.stdout).toContain("ch1:4:9 error continuity/invariant [deterministic]");

    const listed = JSON.parse(run(["lint", "invariant", "list", "--json"])) as { invariants: Array<{ id: string; status: string }> };
    expect(listed.invariants.map((inv) => [inv.id, inv.status])).toEqual([
      ["mira-captain-identity", "approved"],
      ["the-reader-never-sees-inside-the-vault-until-the", "approved"],
      ["tomas-never-lies", "proposed"],
    ]);
    expect(run(["lint", "invariant", "list"])).toContain("check: {\"kind\":\"not-before\"");

    run(["lint", "invariant", "remove", "mira-captain-identity"]);
    expect(lint().diagnostics.map((d) => d.code)).toEqual(["the-reader-never-sees-inside-the-vault-until-the"]);
    const saved = JSON.parse(await readFile(join(bookDir, "story", "plotlint", "invariants.json"), "utf-8")) as { version: number; invariants: unknown[] };
    expect(saved).toMatchObject({ version: 1 });
    expect(saved.invariants).toHaveLength(2);
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

  /** Like `run`, but returns a non-zero exit with its output instead of throwing. */
  function runWithStatus(args: string[]): { status: number; stdout: string } {
    try {
      return { status: 0, stdout: run(args) };
    } catch (error) {
      const { status, stdout } = error as { status: number | null; stdout: string };
      if (status === null) throw error;
      return { status, stdout };
    }
  }
});
