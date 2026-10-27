import type { RuntimeStateSnapshot } from "@actalk/inkos-core";
import { checkText, type TextDocument } from "@plotlint/rules";
import { beforeAll, describe, expect, it } from "vitest";
import { checkParagraphs, createHarperRule, harperLinter, isMostlyCjk, lintRange, paragraphRanges, projectDictionary } from "../index.js";

const rule = createHarperRule({ language: "plaintext" });
const doc = (text: string): TextDocument => ({ sourceId: "chapter:1", chapter: 1, text });

const snapshot = {
  manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 3, projectionVersion: 1, migrationWarnings: [] },
  currentState: {
    chapter: 3,
    facts: [
      { subject: "Zorbak Thessalyne", predicate: "location", object: "the Vrennish Marches", validFromChapter: 1, validUntilChapter: null, sourceChapter: 1 },
      { subject: "brass_key", predicate: "held_by", object: "Zorbak", validFromChapter: 2, validUntilChapter: null, sourceChapter: 2 },
    ],
  },
  hooks: { hooks: [{ hookId: "h1", startChapter: 1, type: "mystery", status: "open", lastAdvancedChapter: 1, expectedPayoff: "", notes: "Why did Quillaby flee the tower?" }] },
  chapterSummaries: { rows: [{ chapter: 1, title: "Arrival", characters: "Zorbak, Ilvrenne", events: "", stateChanges: "", hookActivity: "", mood: "", chapterType: "" }] },
} as unknown as RuntimeStateSnapshot;

beforeAll(async () => { await harperLinter(); });

describe("projectDictionary", () => {
  it("collects names from facts, summaries and hooks", () => {
    const words = projectDictionary(snapshot);
    expect(words).toEqual(expect.arrayContaining(["Zorbak", "Thessalyne", "Vrennish", "Marches", "brass", "key", "Ilvrenne", "Quillaby"]));
    // Lower-case object words and sentence-initial words are not names.
    expect(words).not.toContain("the");
    expect(words).not.toContain("Why");
    expect(new Set(words).size).toBe(words.length);
  });
});

describe("mechanics/harper", () => {
  it("accepts invented names from story state but flags real misspellings", async () => {
    const text = "Zorbak Thessalyne rode into the Vrennish Marches. Ilvrenne and Zorbak's sister waited, but the wether was cold.";
    const without = await checkText(doc(text), [rule]);
    expect(without.map((d) => d.evidence[0])).toEqual(expect.arrayContaining(["\"Thessalyne\""]));

    const diagnostics = await checkText(doc(text), [rule], { dictionary: projectDictionary(snapshot) });
    const flagged = diagnostics.map((d) => text.slice(d.range!.start, d.range!.end));
    expect(flagged).not.toEqual(expect.arrayContaining(["Zorbak", "Thessalyne", "Vrennish", "Ilvrenne", "Zorbak's"]));
    expect(flagged).toContain("wether");
  });

  it("maps a lint to a warning with a quoted range and a fix that applies", async () => {
    const text = "She walked to teh door.";
    const [finding] = await checkText(doc(text), [rule]);
    expect(finding).toMatchObject({
      ruleId: "mechanics/harper", layer: "mechanics", severity: "warning", confidence: "deterministic", chapter: 1,
      evidence: ["\"teh\""], range: { sourceId: "chapter:1", start: 14, end: 17 },
    });
    expect(finding.code).toMatch(/^[a-z-]+$/u);
    const fix = finding.fixes!.find((f) => f.replacement === "the")!;
    expect(text.slice(0, finding.range!.start) + fix.replacement + text.slice(finding.range!.end)).toBe("She walked to the door.");
  });

  it("keeps ranges on the flagged text after curly quotes, em dashes and emoji", async () => {
    const text = "“Wait,” she said — 😀 then teh cat ran. It was a an omen.";
    const diagnostics = await checkText(doc(text), [rule]);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics) expect(d.evidence[0]).toBe(`"${text.slice(d.range!.start, d.range!.end)}"`);
    expect(diagnostics.map((d) => text.slice(d.range!.start, d.range!.end))).toContain("teh");
  });

  it("skips documents that are mostly CJK", async () => {
    const text = "他推开门，说：“teh 我们走吧。”天色已晚，城门快要关了。";
    expect(isMostlyCjk(text)).toBe(true);
    expect(isMostlyCjk("She said “你好” and left.")).toBe(false);
    expect(await checkText(doc(text), [rule])).toEqual([]);
  });

  it("lints a slice or single paragraphs with document-wide ranges", async () => {
    const text = "The first paragraph is fine.\n\nThe secnd one is not.\n\nAnd teh third.";
    expect(paragraphRanges(text).map(([s, e]) => text.slice(s, e))).toEqual(["The first paragraph is fine.", "The secnd one is not.", "And teh third."]);
    expect(paragraphRanges("A.\n \n\n  B.\n")).toEqual([[0, 2], [8, 10]]);
    const whole = await checkText(doc(text), [rule]);
    const context = { document: doc(text) };
    const [, second, third] = paragraphRanges(text);
    const byParagraph = await checkParagraphs(context, [second, third], { language: "plaintext" });
    expect(byParagraph.map((d) => d.range)).toEqual(whole.map((d) => d.range));
    const sliced = await lintRange(context, third[0], third[1], { language: "plaintext" });
    expect(sliced.map((d) => text.slice(d.range!.start, d.range!.end))).toEqual(["teh"]);
  });

  it("lints a 10k-word chapter after warm-up, and a paragraph well under the keystroke budget", async () => {
    const paragraph = Array.from({ length: 8 }, (_, i) =>
      `Zorbak crossed the ${i % 2 ? "river" : "ridge"} at dusk, and the wind pulled at his cloak while the lanterns of the town burned low behind him.`).join(" ");
    const text = Array.from({ length: 55 }, () => paragraph).join("\n\n");
    expect(text.split(/\s+/u).length).toBeGreaterThan(10_000);
    const context = { document: doc(text), dictionary: projectDictionary(snapshot) };
    await rule.check(context);

    let started = performance.now();
    await rule.check(context);
    const chapterMs = performance.now() - started;

    const [first] = paragraphRanges(text);
    started = performance.now();
    await lintRange(context, first[0], first[1], { language: "plaintext" });
    const paragraphMs = performance.now() - started;

    console.log(`harper: 10k-word chapter ${chapterMs.toFixed(1)} ms, one ~200-word paragraph ${paragraphMs.toFixed(1)} ms`);
    // Loose bounds so CI machines pass; the editor re-lints only changed paragraphs.
    expect(paragraphMs).toBeLessThan(100);
    expect(chapterMs).toBeLessThan(5_000);
  });
});
