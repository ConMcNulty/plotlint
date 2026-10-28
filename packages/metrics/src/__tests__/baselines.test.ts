import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  baseline, BASELINE_GENRES, bandsFromStats, buildBaseline, percentiles, splitChapters, standardEbooksChapters, standardEbooksSpine,
  stripGutenberg, xhtmlToText,
} from "../index.js";

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

  it("computes interpolated percentiles, weighted or not", () => {
    const values = Array.from({ length: 101 }, (_, i) => i);
    expect(percentiles(values)).toEqual({ p5: 5, p10: 10, p50: 50, p90: 90, p95: 95, min: 0, max: 100 });
    expect(percentiles(values, values.map(() => 0.25))).toEqual(percentiles(values));
    // Ten chapters of one book at 0 and one chapter of another at 10, each book weighing the same.
    const weighted = percentiles([...Array(10).fill(0), 10], [...Array(10).fill(0.1), 1]);
    expect(weighted.p90).toBeGreaterThan(percentiles([...Array(10).fill(0), 10]).p90);
    expect(percentiles([7])).toMatchObject({ p5: 7, p95: 7 });
  });

  const se = (body: string, type = "bodymatter z3998:fiction") => [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<html xmlns=\"http://www.w3.org/1999/xhtml\">\r\n<head><title>I</title></head>\r\n",
    `<body epub:type="${type}">\r\n${body}\r\n</body>\r\n</html>\r\n`,
  ].join("");

  it("reads Standard Ebooks XHTML: chapter sections only, as plain paragraphs", () => {
    const chapter = (n: number) => `<section id="chapter-${n}" epub:type="chapter"><h2 epub:type="ordinal">${n}</h2>`
      + `<p>“Well⁠—no,” said Mr.&#160;Knightley &amp; she.<a href="endnotes.xhtml#note-1" id="noteref-1" epub:type="noteref">1</a></p>`
      + `<hr/><p>Line one<br/>\r\n\t\tline <i>two</i>.</p></section>`;
    const part = `<section id="part-1" epub:type="part"><h2>Part One</h2>${chapter(1)}${chapter(2)}</section>`;
    const chapters = standardEbooksChapters(se(part));
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toBe("“Well—no,” said Mr. Knightley & she.\n\n* * *\n\nLine one\nline two.");
    expect(standardEbooksChapters(se("<section epub:type=\"imprint\"><p>Standard Ebooks.</p></section>", "frontmatter"))).toEqual([]);
    expect(standardEbooksChapters(se("<section epub:type=\"prologue\"><p>Before it all.</p></section>"))).toEqual(["Before it all."]);
    expect(xhtmlToText("<p>a&#x2019;b &lt;c&gt;</p>")).toBe("a’b <c>");
  });

  it("lists a content.opf's XHTML in spine order", () => {
    const opf = [
      "<manifest><item href=\"css/core.css\" id=\"core.css\" media-type=\"text/css\"/>",
      "<item href=\"text/chapter-2.xhtml\" id=\"chapter-2.xhtml\" media-type=\"application/xhtml+xml\"/>",
      "<item href=\"text/chapter-1.xhtml\" id=\"chapter-1.xhtml\" media-type=\"application/xhtml+xml\"/></manifest>",
      "<spine><itemref idref=\"chapter-1.xhtml\"/><itemref idref=\"chapter-2.xhtml\"/><itemref idref=\"missing\"/></spine>",
    ].join("\n");
    expect(standardEbooksSpine(opf)).toEqual(["text/chapter-1.xhtml", "text/chapter-2.xhtml"]);
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
      expect(json.sourceBooks.length).toBeGreaterThanOrEqual(4);
      // Measured, not hand-set: every band comes from public-domain books with a source to re-fetch them from.
      expect(json.provisional).toBe(false);
      expect(json.chapters).toBeGreaterThan(50);
      for (const book of json.sourceBooks) {
        expect(book.year).toBeLessThan(1929);
        expect(book.url).toMatch(/^https:\/\//u);
      }
    }
  });
});
