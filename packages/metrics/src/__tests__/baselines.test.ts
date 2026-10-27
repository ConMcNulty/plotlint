import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { baseline, BASELINE_GENRES, bandsFromStats, buildBaseline, percentiles, splitChapters, stripGutenberg } from "../index.js";

const baselinesDir = fileURLToPath(new URL("../../baselines", import.meta.url));

describe("reference corpus", () => {
  const raw = [
    "The Project Gutenberg eBook of Example\r\n\r\nTitle: Example\r\nAuthor: A. Writer\r\n",
    "*** START OF THE PROJECT GUTENBERG EBOOK EXAMPLE ***\r\n",
    "CONTENTS\r\n\r\nCHAPTER I.\r\nCHAPTER II.\r\n\r\n",
    "CHAPTER I.\r\n\r\n", "First chapter words. ".repeat(200), "\r\n\r\n",
    "CHAPTER II. The Second\r\n\r\n", "Second chapter words. ".repeat(200), "\r\n\r\n",
    "*** END OF THE PROJECT GUTENBERG EBOOK EXAMPLE ***\r\nLicense text that is not the book.",
  ].join("");

  it("strips the boilerplate and splits chapters, dropping the table of contents", () => {
    const book = stripGutenberg(raw);
    expect(book.startsWith("CONTENTS")).toBe(true);
    expect(book).not.toMatch(/License|\r/u);
    const chapters = splitChapters(book);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.startsWith("First chapter words.")).toBe(true);
    expect(chapters[1]!.startsWith("Second chapter words.")).toBe(true);
  });

  it("computes interpolated percentiles", () => {
    const stats = percentiles(Array.from({ length: 101 }, (_, i) => i));
    expect(stats).toEqual({ p5: 5, p10: 10, p50: 50, p90: 90, p95: 95, min: 0, max: 100 });
  });

  it("sets floors, ceilings and a dialogue band from the stats", () => {
    const stat = (p5: number, p95: number) => ({ p5, p10: p5, p50: (p5 + p95) / 2, p90: p95, p95, min: p5, max: p95 });
    const bands = bandsFromStats({
      "metrics/lexical-diversity": stat(64.4, 120),
      "metrics/sentence-rhythm": stat(0.456, 0.9),
      "metrics/sentence-rhythm#window": stat(0.18, 0.5),
      "metrics/dialogue-ratio": stat(0.004, 0.62),
      "metrics/sensory-detail": stat(12.34, 40),
      "metrics/wall-of-text": stat(40, 412.6),
    }, { "metrics/lexical-diversity": { min: 1, minWords: 250 } });
    expect(bands).toEqual({
      "metrics/lexical-diversity": { minWords: 250, min: 64 },
      "metrics/sentence-rhythm": { min: 0.46, windowCv: 0.18 },
      "metrics/dialogue-ratio": { max: 0.62 },
      "metrics/sensory-detail": { min: 12.3 },
      "metrics/wall-of-text": { max: 413 },
    });
  });

  it("builds a baseline from chapter texts", () => {
    const chapter = "The bell rang over the grey harbour. “Again?” she asked. Nothing moved in the cold.\n\n".repeat(30);
    const built = buildBaseline("test", [{ book: { title: "Example", author: "A. Writer" }, chapters: [chapter, chapter] }]);
    expect(built.chapters).toBe(2);
    expect(built.metrics["metrics/dialogue-ratio"]!.p50).toBeGreaterThan(0);
    expect(built.bands["metrics/wall-of-text"]!.max).toBeGreaterThan(0);
  });
});

describe("committed baselines", () => {
  it("ships general, mystery, romance and fantasy, matching baselines/*.json", () => {
    expect([...BASELINE_GENRES].sort()).toEqual(["fantasy", "general", "mystery", "romance"]);
    for (const file of readdirSync(baselinesDir).filter((name) => name.endsWith(".json"))) {
      const json = JSON.parse(readFileSync(join(baselinesDir, file), "utf-8"));
      // Run `pnpm --filter @plotlint/metrics baselines -- --sync` if this fails.
      expect(baseline(json.genre)).toEqual(json);
      expect(json.version).toBe(1);
      expect(json.sourceBooks.length).toBeGreaterThan(0);
    }
  });
});
