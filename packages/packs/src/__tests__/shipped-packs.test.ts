import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseline } from "@plotlint/metrics";
import { builtinRegistry, checkText } from "@plotlint/rules";
import { generalPack } from "@plotlint/style/node";
import { bookPackCatalog, builtinPacks, loadPackDir, proposeFromGenre, resolveBookPacks, resolvePacks, validatePack } from "../node.js";

// Rule ids other phase 4 work adds; packs may name them before they exist.
const UPCOMING = new Set([
  "structure/unpaid-setup", "structure/cut-candidate", "structure/open-questions", "structure/subplot-balance",
  "structure/unearned-payoff", "structure/scene-turn", "structure/goal-conflict-outcome", "structure/protagonist-agency",
  "structure/tension-curve", "structure/pov-discipline",
  "metrics/lexical-diversity", "metrics/sentence-rhythm", "metrics/dialogue-ratio", "metrics/sensory-detail",
  "metrics/wall-of-text", "metrics/repeated-phrase", "metrics/predictability",
]);
const known = [...builtinRegistry.list().map((rule) => rule.id), "mechanics/harper"];

describe("shipped packs", () => {
  const packs = builtinPacks();

  it("are general, mystery, romance and fantasy", () => {
    expect([...packs.keys()]).toEqual(["fantasy", "general", "mystery", "romance"]);
  });

  it("validate, naming only known or upcoming rules", () => {
    for (const pack of packs.values()) {
      const problems = validatePack(pack, packs, known);
      expect(problems.filter((problem) => problem.level === "error"), pack.manifest.name).toEqual([]);
      for (const problem of problems) {
        const id = problem.message.split(" ")[0]!;
        expect(UPCOMING.has(id), `${pack.manifest.name}: ${problem.message}`).toBe(true);
      }
      expect(pack.skill).toMatch(/^---\nname: /u);
    }
  });

  it("give general the style package's general pack, ids unchanged", () => {
    expect(packs.get("general")!.styleRules.map((rule) => rule.id)).toEqual(generalPack().map((rule) => rule.id));
  });

  it("each add genre clichés with style/<pack>.<Rule> ids", async () => {
    const samples: Record<string, string> = {
      mystery: "Holmes leapt up. The game is afoot, he thought.",
      romance: "She let out a breath she didn't know she was holding.",
      fantasy: "An ancient evil stirred, and only the chosen one could stop it.",
    };
    for (const [name, text] of Object.entries(samples)) {
      const rules = packs.get(name)!.styleRules;
      expect(rules.map((rule) => rule.id)).toEqual([`style/${name}.Cliches`]);
      const found = await checkText({ sourceId: "chapter:1", chapter: 1, text }, rules);
      expect(found.length, name).toBeGreaterThan(0);
    }
  });

  it("stack into romantasy with the plan's settings", () => {
    const resolved = resolvePacks(["romance", "fantasy"], packs, { knownRuleIds: known });
    expect(resolved.packs).toEqual(["general", "romance", "fantasy"]);
    expect(resolved.config.rules).toMatchObject({
      "continuity/world-rule-broken": "error", "continuity/impossible-travel": "error", "structure/protagonist-agency": "note",
    });
    expect(resolved.metrics["metrics/wall-of-text"]).toEqual({ max: 541, source: "fantasy reference books" });
    expect(resolved.metrics["metrics/dialogue-ratio"]).toEqual({ min: 0, max: 0.69, source: "fantasy reference books" });
    expect(resolved.styleRules.map((rule) => rule.id)).toEqual(expect.arrayContaining(["style/general.Cliches", "style/romance.Cliches", "style/fantasy.Cliches"]));
    const mystery = resolvePacks(["mystery"], packs, { knownRuleIds: known });
    expect(mystery.config.rules).toMatchObject({ "continuity/knowledge-leak": "error", "structure/unpaid-setup": "warning" });
  });

  it("take their metric bands from their genre's measured baseline", () => {
    for (const name of ["mystery", "romance", "fantasy"]) {
      const measured = baseline(name)!;
      expect(measured.provisional, name).toBe(false);
      for (const [id, band] of Object.entries(packs.get(name)!.manifest.metrics ?? {})) {
        expect(band.source, `${name} ${id}`).toBe(`${name} reference books`);
        // A pack band is the genre's own band, or no floor where the genre measured none.
        if (band.min !== undefined) expect(band.min, `${name} ${id} min`).toBe(measured.bands[id]!.min ?? 0);
        if (band.max !== undefined) expect(band.max, `${name} ${id} max`).toBe(measured.bands[id]!.max);
      }
    }
  });

  it("turn genre checks off in general and on in their genre's pack", () => {
    const genre = ["structure/fair-play", "structure/hopeful-ending", "structure/central-relationship", "structure/both-leads-pov"];
    const general = resolvePacks([], packs, { knownRuleIds: known }).config.rules;
    for (const id of genre) expect(general[id], id).toBe("off");
    expect(general["style/invented-term-spelling"]).toBe("note");
    expect(resolvePacks(["mystery"], packs, { knownRuleIds: known }).config.rules).toMatchObject({
      "structure/fair-play": "warning", "structure/hopeful-ending": "off", "style/invented-term-spelling": "note",
    });
    const romantasy = resolvePacks(["romance", "fantasy"], packs, { knownRuleIds: known }).config.rules;
    expect(romantasy).toMatchObject({
      "structure/fair-play": "off", "structure/hopeful-ending": "warning", "structure/central-relationship": "note",
      "structure/both-leads-pov": "note", "style/invented-term-spelling": "warning",
    });
  });

  it("map InkOS genre fields to a default proposal", () => {
    expect(proposeFromGenre("xuanhuan", packs)?.packs).toEqual(["fantasy"]);
    expect(proposeFromGenre("Romantasy", packs)?.packs).toEqual(["fantasy", "romance"]);
    expect(proposeFromGenre("cozy mystery", packs)?.packs).toEqual(["mystery"]);
    expect(proposeFromGenre("悬疑推理", packs)?.packs).toEqual(["mystery"]);
    expect(proposeFromGenre("urban", packs)).toBeUndefined();
    expect(proposeFromGenre("other", packs)).toBeUndefined();
    expect(proposeFromGenre("fantasy", packs)?.reasoning).toContain("\"fantasy\" selects fantasy");
  });
});

describe("book packs", () => {
  it("resolve packs.json and rules.json, and load the book's own packs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plotlint-book-packs-"));
    try {
      const own = join(dir, "story", "plotlint", "packs", "noir");
      await mkdir(own, { recursive: true });
      await writeFile(join(own, "pack.yaml"), "name: noir\ntitle: Noir\ndescription: Hardboiled.\r\nextends: [mystery]\nchecks:\n  continuity/timeline-order: warning\n");
      await writeFile(join(own, "SKILL.md"), "---\nname: noir\n---\n");
      expect(loadPackDir(own).manifest.extends).toEqual(["mystery"]);
      expect([...bookPackCatalog(dir).keys()]).toContain("noir");

      const book = {
        packs: { version: 1 as const, packs: ["noir", "western"] },
        config: { version: 1 as const, rules: { "continuity/knowledge-leak": "off" as const } },
      };
      const result = resolveBookPacks(dir, book, known);
      expect(result.missing).toEqual(["western"]);
      expect(result.resolved.packs).toEqual(["general", "mystery", "noir"]);
      expect(result.config.rules).toMatchObject({ "continuity/knowledge-leak": "off", "continuity/timeline-order": "warning" });
      expect(resolveBookPacks(dir, {}, known).resolved.packs).toEqual(["general"]);

      await writeFile(join(own, "pack.yaml"), "name: noir2\ntitle: Noir\ndescription: d\n");
      expect(() => bookPackCatalog(dir)).toThrow(/folder "noir"/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
