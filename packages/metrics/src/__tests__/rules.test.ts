import { checkText, type TextDocument } from "@plotlint/rules";
import { describe, expect, it } from "vitest";
import { baselineBands, createMetricRules, METRIC_RULE_IDS, metricRuleInfo } from "../index.js";

const doc = (text: string): TextDocument => ({ sourceId: "chapter:1", chapter: 1, text });

// Varied, sensory, partly spoken prose: inside every general band.
const healthy = Array.from({ length: 12 }, (_, i) => [
  `The bell rang ${i + 1} times over the grey harbour while gulls screamed above the cold, wet stones of pier number ${i + 1}.`,
  `“Again?” Mira asked.`,
  `She smelled salt and smoke, felt the rough rope burn her palm, and tasted something bitter on her tongue as the lantern flickered.`,
  `Nothing moved.`,
].join(" ")).join("\n\n").replace(/pier number (\d+)/gu, (_, n) => `${["north", "south", "east", "west", "old", "new", "long", "short", "broken", "painted", "silent", "last"][Number(n) - 1]} pier`);

const ids = (diagnostics: Array<{ ruleId: string }>) => diagnostics.map((d) => d.ruleId);

describe("createMetricRules", () => {
  it("exports one rule per metric id, with title, rationale and source", () => {
    const rules = createMetricRules();
    expect(rules.map((rule) => rule.id)).toEqual([...METRIC_RULE_IDS]);
    for (const rule of rules) {
      expect(rule.layer).toBe("metrics");
      expect(rule.title).toBe(metricRuleInfo[rule.id as (typeof METRIC_RULE_IDS)[number]].title);
      expect(rule.rationale.length).toBeGreaterThan(20);
      expect(rule.source.length).toBeGreaterThan(10);
    }
  });

  it("raises nothing for a chapter inside every band", async () => {
    expect(await checkText(doc(healthy), createMetricRules())).toEqual([]);
  });

  it("flags low lexical diversity below the floor only, as a deterministic note on the first paragraph", async () => {
    const dull = Array.from({ length: 80 }, () => "The man saw the dog and the dog saw the man.").join(" ");
    const found = await checkText(doc(dull), createMetricRules({ "metrics/lexical-diversity": { min: 60, max: 70 } }));
    const finding = found.find((d) => d.ruleId === "metrics/lexical-diversity")!;
    expect(finding.severity).toBe("note");
    expect(finding.confidence).toBe("deterministic");
    expect(finding.range).toEqual({ sourceId: "chapter:1", start: 0, end: dull.length });
    expect(finding.evidence[1]).toMatch(/^MTLD \d+ \(band 60–70 from provisional general bands\)$/u);
    // A floor alone never flags rich text, however rich.
    expect(ids(await checkText(doc(healthy), createMetricRules({ "metrics/lexical-diversity": { min: 10 } })))).not.toContain("metrics/lexical-diversity");
  });

  it("flags dialogue outside its band on either side", async () => {
    const spoken = Array.from({ length: 60 }, (_, i) => `“Word ${i} went round the town today,” she said.`).join("\n\n");
    const high = await checkText(doc(spoken), createMetricRules({ "metrics/dialogue-ratio": { min: 0.1, max: 0.5 } }));
    const finding = high.find((d) => d.ruleId === "metrics/dialogue-ratio")!;
    expect(finding.summary).toMatch(/Dialogue-heavy/u);
    expect(finding.evidence[1]).toMatch(/^Dialogue \d+% of words \(band 10%–50% from provisional general bands\)$/u);
    const low = await checkText(doc(healthy), createMetricRules({ "metrics/dialogue-ratio": { min: 0.5 } }));
    expect(low.find((d) => d.ruleId === "metrics/dialogue-ratio")!.summary).toMatch(/Very little dialogue/u);
  });

  it("flags too little sensory detail, and a wall of text ranged over the run", async () => {
    const abstract = Array.from({ length: 60 }, (_, i) => `He considered the matter of policy number ${i} with some care, as was his habit.`).join("\n\n");
    expect(ids(await checkText(doc(abstract), createMetricRules()))).toContain("metrics/sensory-detail");

    const wallText = `${healthy}\n\n${Array.from({ length: 50 }, () => "Then the long account of the treaty went on").join(" and ")}.`;
    const walls = (await checkText(doc(wallText), createMetricRules())).filter((d) => d.ruleId === "metrics/wall-of-text");
    expect(walls).toHaveLength(1);
    expect(wallText.slice(walls[0]!.range!.start, walls[0]!.range!.end)).toMatch(/^Then the long account.*treaty went on$/u);
    expect(walls[0]!.evidence[1]).toMatch(/^Longest unbroken narration \d+ words \(ceiling 350 from provisional general bands\)$/u);
  });

  it("flags flat rhythm over the flat stretch", async () => {
    const flat = Array.from({ length: 40 }, (_, i) => `The ${["cat", "dog", "cow", "hen", "fox"][i % 5]} sat by the ${["fire", "door", "well", "wall"][i % 4]} again.`).join(" ");
    const text = `${healthy}\n\n${flat}`;
    const found = (await checkText(doc(text), createMetricRules())).filter((d) => d.ruleId === "metrics/sentence-rhythm");
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe("flat-stretch");
    expect(text.slice(found[0]!.range!.start, found[0]!.range!.end)).toBe(flat);
  });

  it("skips chapters too short to judge and CJK chapters", async () => {
    expect(await checkText(doc("The man saw the dog. The dog saw the man."), createMetricRules({ "metrics/lexical-diversity": { min: 1000 } }))).toEqual([]);
    expect(await checkText(doc("雾从海上来。".repeat(300)), createMetricRules())).toEqual([]);
  });

  it("lays pack bands over the general baseline key by key", async () => {
    const general = baselineBands("general");
    expect(general["metrics/wall-of-text"]).toMatchObject({ max: 350, source: "provisional general bands" });
    expect(() => baselineBands("nonesuch")).toThrow(/no metric baseline/u);
    const longWall = `${healthy}\n\n${Array.from({ length: 50 }, () => "Then the long account went on").join(" and ")}.`;
    const loose = await checkText(doc(longWall), createMetricRules({ "metrics/wall-of-text": { max: 1000 } }));
    expect(ids(loose)).not.toContain("metrics/wall-of-text");
  });
});
