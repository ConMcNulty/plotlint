import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createWorkManifest, saveWorkManifest } from "@actalk/inkos-core";
import { parsePackNames } from "../commands/lint-packs.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(testDir, "..", "..", "dist", "index.js");

describe("parsePackNames", () => {
  it("splits on commas and spaces, lowercases and dedupes", () => {
    expect(parsePackNames(["Romance,fantasy", "romance", " "])).toEqual(["romance", "fantasy"]);
  });
});

describe("inkos lint packs", () => {
  let projectDir: string;
  let bookDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-packs-"));
    run(["init"]);
    await saveWorkManifest(projectDir, createWorkManifest({ id: "thorn", title: "Thorn Court", profileId: "longform-novel", language: "en" }));
    bookDir = new StateManager(projectDir).bookDir("thorn");
    const now = new Date().toISOString();
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "book.json"), JSON.stringify({
      id: "thorn", title: "Thorn Court", platform: "other", genre: "romantasy", status: "active",
      targetChapters: 20, chapterWordCount: 3000, language: "en", createdAt: now, updatedAt: now,
    }));
    await writeFile(join(bookDir, "chapters", "0001_one.md"), "# One\n\nAn ancient evil stirred. She was very tired.\n");
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  type Lint = { books: Array<{ packs: string[]; diagnostics: Array<{ ruleId: string; severity: string }> }> };
  // An error-severity finding exits 1, with the JSON still on stdout.
  const lint = () => {
    let stdout: string;
    try {
      stdout = run(["lint", "thorn", "--json", "--layers", "style"]);
    } catch (error) {
      stdout = (error as { stdout: string }).stdout;
    }
    return (JSON.parse(stdout) as Lint).books[0]!;
  };

  it("proposes from the genre field, accepts, and lints with the packs and rules.json", async () => {
    expect(lint()).toMatchObject({ packs: ["general"], diagnostics: [{ ruleId: "style/general.Intensifiers" }] });

    const proposed = JSON.parse(run(["lint", "packs", "propose", "thorn", "--json"]));
    expect(proposed).toMatchObject({ source: "genre", proposed: { packs: ["fantasy", "romance"] } });
    expect(lint().packs).toEqual(["general"]);
    expect(run(["lint", "packs", "thorn"])).toContain("proposed: fantasy + romance (inkos lint packs accept)");

    expect(run(["lint", "packs", "accept"])).toContain("now runs general + fantasy + romance");
    const saved = JSON.parse(await readFile(join(bookDir, "story", "plotlint", "packs.json"), "utf-8"));
    expect(saved).toEqual({ version: 1, packs: ["fantasy", "romance"] });
    expect(lint().diagnostics.map((d) => [d.ruleId, d.severity])).toEqual([
      ["style/fantasy.Cliches", "note"], ["style/general.Intensifiers", "note"],
    ]);

    await writeFile(join(bookDir, "story", "plotlint", "rules.json"), JSON.stringify({
      version: 1, rules: { "style/fantasy.Cliches": "error", "style/general.Intensifiers": "off", "continuity/world-rule-broken": "warning" },
    }));
    expect(lint().diagnostics.map((d) => [d.ruleId, d.severity])).toEqual([["style/fantasy.Cliches", "error"]]);

    const listed = JSON.parse(run(["lint", "packs", "thorn", "--json"])) as {
      packs: string[]; available: Array<{ name: string }>; rules: Array<{ id: string; setting?: unknown; from: string[] }>;
    };
    expect(listed.packs).toEqual(["general", "fantasy", "romance"]);
    expect(listed.available.map((pack) => pack.name)).toEqual(["fantasy", "general", "mystery", "romance"]);
    expect(listed.rules.find((rule) => rule.id === "continuity/impossible-travel")).toEqual({ id: "continuity/impossible-travel", setting: "error", from: ["fantasy"] });
    expect(listed.rules.find((rule) => rule.id === "continuity/world-rule-broken")).toMatchObject({ setting: "warning", from: ["rules.json"] });
    expect(listed.rules.find((rule) => rule.id === "structure/protagonist-agency")).toMatchObject({ setting: "note", from: ["romance"] });
  });

  it("lists every rule with its effective setting and where it comes from", async () => {
    run(["lint", "packs", "use", "romance"]);
    await writeFile(join(bookDir, "story", "plotlint", "rules.json"), JSON.stringify({
      version: 1, rules: { "metrics/wall-of-text": "warning" },
    }));
    // Five rejected Intensifiers findings: the adaptive overlay lowers the rule to a note.
    const verdicts = Array.from({ length: 5 }, (_, index) => JSON.stringify({
      ruleId: "style/general.Intensifiers", fingerprint: `fp${index}`, verdict: "rejected", action: "not-useful",
      at: new Date(2026, 0, 1, 0, index).toISOString(), layer: "style", confidence: "deterministic",
    })).join("\n");
    await writeFile(join(bookDir, "story", "plotlint", "verdicts.jsonl"), `${verdicts}\n`);

    type Row = { id: string; layer: string; enabled: boolean; severity?: string; band?: unknown; from: string[] };
    const { rules } = JSON.parse(run(["lint", "rules", "thorn", "--json"])) as { rules: Row[] };
    const byId = new Map(rules.map((rule) => [rule.id, rule]));
    expect(byId.get("style/general.Intensifiers")).toMatchObject({ layer: "style", severity: "note", from: ["adaptive"] });
    expect(byId.get("metrics/wall-of-text")).toMatchObject({ layer: "metrics", severity: "warning", from: ["rules.json"] });
    // Romance sets no band of its own (its reference books measure inside the general bands).
    expect(byId.get("metrics/dialogue-ratio")).toMatchObject({ layer: "metrics", enabled: true });
    expect(byId.get("metrics/dialogue-ratio")!.band).toBeUndefined();
    expect(byId.get("structure/subplot-balance")).toMatchObject({ layer: "structure", severity: "note", from: ["romance"] });
    expect(byId.get("mechanics/harper")).toMatchObject({ layer: "mechanics", enabled: true });
    expect(byId.has("metrics/repeated-phrase")).toBe(true);
    expect(byId.has("metrics/predictability")).toBe(true);
    expect(run(["lint", "rules", "thorn"])).toMatch(/style\/general\.Intensifiers {2}note {2}\(adaptive\)/u);
  });

  it("uses packs by name and rejects unknown ones", async () => {
    expect(run(["lint", "packs", "use", "mystery,romance", "--book", "thorn"])).toContain("now runs general + mystery + romance");
    expect(lint().packs).toEqual(["general", "mystery", "romance"]);
    expect(() => run(["lint", "packs", "use", "horror"])).toThrow(/unknown pack "horror"/u);
    run(["lint", "packs", "use", "general"]);
    expect(lint().packs).toEqual(["general"]);
  });

  function run(args: string[]): string {
    return execFileSync("node", [cliEntry, ...args], {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INKOS_"))),
        HOME: projectDir,
      },
    });
  }
});
