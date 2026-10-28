import { checkText, type TextDocument } from "@plotlint/rules";
import { describe, expect, it } from "vitest";
import { baselineBands, createMetricRules, METRIC_RULE_IDS, metricRuleInfo } from "../index.js";

const doc = (text: string): TextDocument => ({ sourceId: "chapter:1", chapter: 1, text });

// Varied, sensory, partly spoken prose: inside every general band.
const healthy = [
  "The bell rang six times over the grey harbour while gulls screamed above the cold, wet stones of the north pier. Mira pulled her collar higher and counted the boats still out.",
  "“Again?” Tomas asked, squinting at the water.",
  "She smelled salt and coal smoke, felt the rough rope burn her palm, and tasted something bitter at the back of her throat. Nothing moved on the channel.",
  "“They should have been back by noon,” she said. “Father never stays past the turn of the tide.”",
  "Tomas shrugged, kicked a loose pebble into the dark, and listened to it click down the slipway. Somewhere behind the warehouses a dog barked twice and stopped.",
  "The lantern above the customs house flickered, steadied, then guttered again. Its yellow light made the puddles look like spilled honey.",
  "“Maybe the fog held them at Kell’s Point,” he offered. “Ada says it’s thick as wool out past the reef.”",
  "Mira did not answer. She was watching a smudge on the horizon, small and crooked, that might have been a mast or might have been nothing at all.",
  "Old Petra came down the steps from the chandlery with a tin mug of tea, steam curling from the rim, and pressed it into Mira’s cold fingers without a word.",
  "“Drink,” the woman said at last. “Waiting is hungry work.”",
  "The tea was stewed and sweet, thick with condensed milk, and it scalded her tongue. She drank it anyway, because the heat was the only certain thing on the quay.",
  "By the time the clock in the square struck seven, the smudge had become a hull, and the hull had become her father’s blue trawler, listing slightly to port, its engine coughing like an old man climbing stairs.",
  "Tomas whooped. Gulls scattered from the bollards in a white, shrieking cloud.",
  "Mira set the empty mug down very carefully on the wall, as if it might shatter, and only then did she let herself run.",
  "Her boots slapped the planks. Spray from a breaking wave stung her cheeks, sharp and briny, and she could hear her own breath rasping louder than the sea.",
  "“Catch!” her father shouted, and a coil of wet line came flying over the gunwale toward her outstretched hands.",
  "She caught it, braced her heels against an iron cleat, and hauled until her shoulders ached. The trawler bumped the fenders with a groan of timber.",
  "“Did you see the lights at Kell’s Point?” Tomas called up, his voice cracking with relief. “Ada swore she saw green flares.”",
  "“Green, red, purple,” her father grumbled, swinging one stiff leg over the rail. “I saw fog, lad, and a great deal of it, and a seal that followed us home.”",
  "Petra laughed, a dry rattle like gravel in a pail, and went back up the steps to fetch more tea. The smell of diesel and fish guts hung over everything.",
  "Later, warming by the stove in the net loft, she would remember the weight of that rope more clearly than anything her father said about the engine, the fog, or the reef.",
].join("\n\n");

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
    expect(finding.evidence[1]).toMatch(/^MTLD \d+ \(band 60–70 from general reference books\)$/u);
    // A floor alone never flags rich text, however rich.
    expect(ids(await checkText(doc(healthy), createMetricRules({ "metrics/lexical-diversity": { min: 10 } })))).not.toContain("metrics/lexical-diversity");
  });

  it("flags dialogue outside its band on either side", async () => {
    const spoken = Array.from({ length: 60 }, (_, i) => `“Word ${i} went round the town today,” she said.`).join("\n\n");
    const high = await checkText(doc(spoken), createMetricRules({ "metrics/dialogue-ratio": { min: 0.1, max: 0.5 } }));
    const finding = high.find((d) => d.ruleId === "metrics/dialogue-ratio")!;
    expect(finding.summary).toMatch(/Dialogue-heavy/u);
    expect(finding.evidence[1]).toMatch(/^Dialogue \d+% of words \(band 10%–50% from general reference books\)$/u);
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
    const ceiling = baselineBands("general")["metrics/wall-of-text"]!.max;
    expect(walls[0]!.evidence[1]).toMatch(new RegExp(`^Longest unbroken narration \\d+ words \\(ceiling ${ceiling} from general reference books\\)$`, "u"));
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
    expect(general["metrics/wall-of-text"]).toMatchObject({ max: expect.any(Number), source: "general reference books" });
    expect(() => baselineBands("nonesuch")).toThrow(/no metric baseline/u);
    const longWall = `${healthy}\n\n${Array.from({ length: 50 }, () => "Then the long account went on").join(" and ")}.`;
    const loose = await checkText(doc(longWall), createMetricRules({ "metrics/wall-of-text": { max: 1000 } }));
    expect(ids(loose)).not.toContain("metrics/wall-of-text");
  });
});
