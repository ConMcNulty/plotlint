import { describe, expect, it } from "vitest";
import { checkText, type TextRule } from "@plotlint/rules";
import { format, loadStyleRules, segments, StyleLoadError, styleRuleId } from "../index.js";

const doc = (text: string) => ({ sourceId: "chapter:1", chapter: 1, text });

async function run(rules: TextRule[], text: string) {
  const diagnostics = await checkText(doc(text), rules);
  // Every range must be exact: slicing the text gives back the quoted match.
  for (const d of diagnostics) expect(d.evidence[0]).toBe(`"${text.slice(d.range!.start, d.range!.end)}"`);
  return diagnostics;
}

describe("loadStyleRules", () => {
  it("names rules style/<Style>.<Rule>, or style/<file> without a folder", () => {
    expect(styleRuleId("General/FilterWords.yml")).toBe("style/General.FilterWords");
    expect(styleRuleId("packs/Mystery/Clues.yaml")).toBe("style/Mystery.Clues");
    expect(styleRuleId("Weasel.yml")).toBe("style/Weasel");
  });

  it("reports unknown and unsupported types and bad specs as one load error", () => {
    const load = () => loadStyleRules({
      "A/Bogus.yml": "extends: bogus\ntokens: [x]",
      "A/Rep.yml": "extends: repetition\ntokens: [x]",
      "A/Level.yml": "extends: existence\nlevel: fatal\ntokens: [x]",
      "A/Regex.yml": "extends: existence\ntokens: ['(']",
      "A/Ext.yml": "extends: existence\ntokens: [x]\nplotlint: { skipDialog: true }",
      "A/Ok.yml": "extends: existence\ntokens: [x]",
    });
    expect(load).toThrow(StyleLoadError);
    try { load(); } catch (error) {
      const problems = (error as StyleLoadError).problems;
      expect(problems.map((p) => p.source)).toEqual(["A/Bogus.yml", "A/Rep.yml", "A/Level.yml", "A/Regex.yml", "A/Ext.yml"]);
      expect(problems[0]!.message).toMatch(/unknown Vale rule type `bogus`/);
      expect(problems[1]!.message).toMatch(/not supported/);
    }
  });

  it("interpolates %s in order and keeps %% literal", () => {
    expect(format("Use '%s' instead of '%s' (100%%).", ["a", "b"])).toBe("Use 'a' instead of 'b' (100%).");
  });
});

describe("existence", () => {
  const [rule] = loadStyleRules({
    "T/Weasel.yml": [
      "extends: existence", "message: \"Avoid '%s'.\"", "level: warning", "ignorecase: true",
      "link: https://example.com/weasel", "description: Weasel words weaken prose.",
      "tokens: [very, 'real\\w*']", "exceptions: [realms?]",
    ].join("\n"),
  });

  it("matches whole words case-insensitively, with exact ranges, message and link", async () => {
    const text = "It was VERY cold. Everyone was really tired in the Realm. Every day.";
    const diagnostics = await run([rule!], text);
    expect(diagnostics.map((d) => text.slice(d.range!.start, d.range!.end))).toEqual(["VERY", "really"]);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "style/T.Weasel", layer: "style", severity: "warning", summary: "Avoid 'VERY'.",
      evidence: ["\"VERY\"", "See https://example.com/weasel"],
    });
    expect(rule!.rationale).toBe("Weasel words weaken prose. https://example.com/weasel");
  });

  it("supports nonword, raw, case-sensitive matching and level mapping", async () => {
    const rules = loadStyleRules({
      "T/Dash.yml": "extends: existence\nnonword: true\ntokens: ['--']",
      "T/Raw.yml": "extends: existence\nlevel: error\nraw: ['\\d+', '%']",
      "T/Case.yml": "extends: existence\ntokens: [Tom]",
    });
    const text = "Tom--tomorrow, 50% of tom.";
    const diagnostics = await run(rules, text);
    expect(diagnostics.map((d) => [d.ruleId, text.slice(d.range!.start, d.range!.end), d.severity])).toEqual([
      ["style/T.Case", "Tom", "note"],
      ["style/T.Dash", "--", "note"],
      ["style/T.Raw", "50%", "error"],
    ]);
  });

  it("skips dialogue only when the rule opts in", async () => {
    const yaml = "extends: existence\ntokens: [saw]";
    const [plain] = loadStyleRules({ "T/Plain.yml": yaml });
    const [skip] = loadStyleRules({ "T/Skip.yml": `${yaml}\nplotlint:\n  skipDialogue: true` });
    const text = "\"I saw it,\" she said. She saw it too. “We all saw it.”";
    expect(await run([plain!], text)).toHaveLength(3);
    const skipped = await run([skip!], text);
    expect(skipped.map((d) => d.range!.start)).toEqual([text.indexOf("She saw") + 4]);
  });
});

describe("substitution", () => {
  const [rule] = loadStyleRules({
    "T/Swap.yml": [
      "extends: substitution", "message: \"Use '%s' instead of '%s'.\"", "ignorecase: true",
      "swap:", "  utilize: use", "  in order to: to", "  alright: all right|fine", "  nodded (?:his|her) head: nodded",
    ].join("\n"),
  });

  it("offers each swap value as a fix, keeping a leading capital", async () => {
    const text = "Utilize the key in order to open it. Alright, she nodded her head. Use it.";
    const diagnostics = await run([rule!], text);
    expect(diagnostics.map((d) => [text.slice(d.range!.start, d.range!.end), d.summary, d.fixes])).toEqual([
      ["Utilize", "Use 'use' instead of 'Utilize'.", [{ title: "Replace with \"Use\"", replacement: "Use" }]],
      ["in order to", "Use 'to' instead of 'in order to'.", [{ title: "Replace with \"to\"", replacement: "to" }]],
      ["Alright", "Use 'all right' or 'fine' instead of 'Alright'.", [
        { title: "Replace with \"All right\"", replacement: "All right" },
        { title: "Replace with \"Fine\"", replacement: "Fine" },
      ]],
      ["nodded her head", "Use 'nodded' instead of 'nodded her head'.", [{ title: "Replace with \"nodded\"", replacement: "nodded" }]],
    ]);
  });

  it("applying the fix replaces exactly the matched span", async () => {
    const text = "She utilized nothing. They utilize it.";
    const [d] = await run([rule!], text);
    expect(text.slice(0, d!.range!.start) + d!.fixes![0]!.replacement + text.slice(d!.range!.end)).toBe("She utilized nothing. They use it.");
  });
});

describe("occurrence", () => {
  const load = (scope: string, max: number) => loadStyleRules({
    [`T/${scope}.yml`]: `extends: occurrence\nmessage: '%s adverbs.'\nscope: ${scope}\nmax: ${max}\ntoken: '\\b\\w+ly\\b'`,
  });

  it("flags a sentence over the limit, underlining first to last match", async () => {
    const text = "She quickly and quietly and softly left. He slowly sat.\n\nThey gladly, sadly, badly sang.";
    const diagnostics = await run(load("sentence", 2), text);
    expect(diagnostics.map((d) => [text.slice(d.range!.start, d.range!.end), d.summary])).toEqual([
      ["quickly and quietly and softly", "3 adverbs."],
      ["gladly, sadly, badly", "3 adverbs."],
    ]);
    expect(diagnostics[0]!.evidence[1]).toBe("3 matches (max 2): quickly, quietly, softly");
  });

  it("counts per paragraph and per text", async () => {
    const text = "She quickly left. He slowly sat.\n\nThey gladly sang.";
    expect(await run(load("paragraph", 1), text)).toHaveLength(1);
    expect(await run(load("text", 2), text)).toHaveLength(1);
    expect(await run(load("text", 3), text)).toHaveLength(0);
  });

  it("splits sentences and paragraphs to trimmed spans", () => {
    const text = "One. Two!  “Three?”\nFour\n\n Five.";
    expect(segments(text, "sentence").map(([s, e]) => text.slice(s, e))).toEqual(["One.", "Two!", "“Three?”", "Four", "Five."]);
    expect(segments(text, "paragraph").map(([s, e]) => text.slice(s, e))).toEqual(["One. Two!  “Three?”\nFour", "Five."]);
  });
});
