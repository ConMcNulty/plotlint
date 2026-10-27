import { DiagnosticSchema } from "@plotlint/diagnostics";
import { describe, expect, it } from "vitest";
import { findRepeatedPhrases, metricStateRules } from "../index.js";

const FILLER = [
  "Rain fell on the market while traders packed their carts.",
  "Snow buried the northern road before anyone could leave.",
  "Fog crept along every canal until the bridges vanished.",
];
const filler = (n: number) => FILLER[(n - 1) % FILLER.length]!;
const book = (...chapters: string[]) => new Map(chapters.map((text, i) => [i + 1, text] as const));
const run = (chapters: Map<number, string>, options: Record<string, unknown> = {}, names?: string[]) =>
  metricStateRules({ ...(names ? { names } : {}) })[0]!.check({ snapshot: {} as never, chapters, options });

describe("metrics/repeated-phrase", () => {
  it("flags a phrase in three chapters at its first use in each later chapter", () => {
    const chapters = book(
      `${filler(1)} Her heart skipped a beat at the sight.`,
      `${filler(2)}\n\nOnce more her heart skipped a beat. Later her heart skipped a beat again.`,
      `${filler(3)} When he smiled, her heart skipped a beat.`,
    );
    const diagnostics = run(chapters);
    expect(diagnostics.map((d) => [d.chapter, d.range!.sourceId])).toEqual([[2, "chapter:2"], [3, "chapter:3"]]);
    const [second] = diagnostics;
    expect(chapters.get(2)!.slice(second!.range!.start, second!.range!.end)).toBe("her heart skipped a beat");
    expect(second!.summary).toBe(`"her heart skipped a beat" recurs in 3 chapters`);
    expect(second!.evidence).toContain("Also in ch1, ch3 (3 chapters; reported from 3)");
    expect(second!.evidence).toContain("2 times in this chapter");
    for (const diagnostic of diagnostics) {
      expect(DiagnosticSchema.parse(diagnostic)).toMatchObject({ layer: "metrics", severity: "note", confidence: "deterministic" });
    }
  });

  it("reports the longest phrase, not each of its sub-phrases", () => {
    const phrases = findRepeatedPhrases(book(
      `${filler(1)} The wind howled through the broken shutters.`,
      `${filler(2)} The wind howled through the broken shutters.`,
      `${filler(3)} The wind howled through the broken shutters.`,
    ));
    expect(phrases.map((phrase) => phrase.phrase)).toEqual(["the wind howled through the broken shutters"]);
  });

  it("ignores names, dialogue tags and function-word strings", () => {
    const chapters = book(
      `${filler(1)} "Fine," said Aurel Harrow to her. It was as if she had been there.`,
      `${filler(2)} "No," said Aurel Harrow to her. It was as if she had been there.`,
      `${filler(3)} "Go," said Aurel Harrow to her. It was as if she had been there.`,
    );
    expect(run(chapters, {}, ["Aurel Harrow"])).toEqual([]);
    // Without the dictionary the name makes the gram distinctive.
    expect(run(chapters).map((d) => d.summary)).toContain(`"said aurel harrow to her" recurs in 3 chapters`);
    // Names also come from the rule options in the book's config.
    expect(run(chapters, { names: ["Harrow", "Aurel"] })).toEqual([]);
  });

  it("ignores the book's own recurring terms and honours minChapters", () => {
    // "of the lantern house" is in every chapter, but the lantern house is where the book happens.
    expect(run(book(
      `${filler(1)} The door of the lantern house stood open. Gulls circled the lantern house.`,
      `${filler(2)} Smoke rose from the roof of the lantern house. Nobody had kept the lantern house in years.`,
      `${filler(3)} She climbed the stair of the lantern house. The lantern house was silent.`,
    ))).toEqual([]);
    const two = book(`${filler(1)} Her heart skipped a beat.`, `${filler(2)} Her heart skipped a beat.`);
    expect(run(two)).toEqual([]);
    expect(run(two, { minChapters: 2 })).toHaveLength(1);
  });

  it("needs chapter text", () => {
    expect(metricStateRules()[0]!.check({ snapshot: {} as never, options: {} })).toEqual([]);
  });
});
