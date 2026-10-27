import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkText, configureTextRules, PacksFileSchema, textDiagnostic, type TextRule } from "../index.js";
import { loadBookRuleData, readPlotlintFile, writePlotlintFile } from "../node.js";

const document = { sourceId: "chapter:1", chapter: 1, text: "She was very, very tired." };

const veryRule: TextRule = {
  id: "style/very",
  layer: "style",
  rationale: "Intensifiers usually weaken the word they prop up.",
  check({ document, options }) {
    const limit = typeof options?.limit === "number" ? options.limit : Infinity;
    return [...document.text.matchAll(/\bvery\b/gu)].slice(0, limit).map((match) => textDiagnostic({
      rule: this, document, start: match.index!, end: match.index! + match[0].length, summary: "Intensifier.",
    }));
  },
};
const otherRule: TextRule = { ...veryRule, id: "style/other", check: veryRule.check };

describe("configureTextRules", () => {
  it("leaves rules unchanged without a config", async () => {
    expect(configureTextRules([veryRule])).toEqual([veryRule]);
    const found = await checkText(document, configureTextRules([veryRule], { version: 1, rules: {} }));
    expect(found.map((d) => d.severity)).toEqual(["warning", "warning"]);
  });

  it("turns rules off, overrides severity and passes options", async () => {
    const off = configureTextRules([veryRule, otherRule], { version: 1, rules: { "style/other": "off" } });
    expect(off.map((rule) => rule.id)).toEqual(["style/very"]);

    const noted = await checkText(document, configureTextRules([veryRule], { version: 1, rules: { "style/very": "note" } }));
    expect(noted.map((d) => d.severity)).toEqual(["note", "note"]);

    const limited = await checkText(document, configureTextRules([veryRule], {
      version: 1, rules: { "style/very": { severity: "error", options: { limit: 1 } } },
    }));
    expect(limited.map((d) => [d.ruleId, d.severity])).toEqual([["style/very", "error"]]);

    expect(configureTextRules([veryRule], { version: 1, rules: { "style/very": { severity: "off" } } })).toEqual([]);
  });
});

describe("packs.json", () => {
  it("round-trips through the plotlint folder and is part of the book's rule data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plotlint-packs-"));
    try {
      expect((await loadBookRuleData(dir)).packs).toBeUndefined();
      const proposed = { packs: ["romance", "fantasy"], reasoning: "A fae court and a slow-burn romance.", at: "2026-10-27T00:00:00.000Z" };
      await writePlotlintFile(dir, "packs.json", PacksFileSchema, { version: 1, packs: ["mystery"], proposed });
      expect(await readPlotlintFile(dir, "packs.json", PacksFileSchema)).toEqual({ version: 1, packs: ["mystery"], proposed });
      expect((await loadBookRuleData(dir)).packs?.packs).toEqual(["mystery"]);

      await mkdir(join(dir, "story", "plotlint"), { recursive: true });
      await writeFile(join(dir, "story", "plotlint", "packs.json"), JSON.stringify({ version: 1, packs: "mystery" }));
      await expect(loadBookRuleData(dir)).rejects.toThrow(/packs\.json/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
