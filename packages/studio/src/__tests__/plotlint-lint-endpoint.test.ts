import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, saveRuntimeStateSnapshot } from "@actalk/inkos-core";
import { createStudioServer } from "../api/server.js";

interface LintResponse {
  sourceId: string;
  diagnostics: Array<{
    ruleId: string;
    layer: string;
    severity: string;
    confidence: string;
    chapter?: number;
    summary: string;
    fingerprint: string;
    range?: { sourceId: string; start: number; end: number };
    fixes?: Array<{ title: string; replacement: string }>;
  }>;
  ranges: Array<{ start: number; end: number }> | null;
  suppressed: number;
  stateMissing: boolean;
}

const BOOK = "harbour-book";

const CHAPTER = [
  "# Chapter 3",
  "",
  "Zorbak walked to the harbour while Mira waited.",
  "",
  "She was very tired and teh night was dark.",
  "",
  "In the end, it was what it was.",
].join("\n");

describe("plotlint lint endpoint", () => {
  let root: string;
  let bookDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-plotlint-"));
    bookDir = new StateManager(root).bookDir(BOOK);
    await mkdir(bookDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const lint = async (body: Record<string, unknown>) => {
    const app = createStudioServer({} as never, root);
    return app.request("/api/v1/plotlint/lint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  const saveState = (facts: Array<[string, string, string, number, number | null]>) =>
    saveRuntimeStateSnapshot(bookDir, {
      manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 3, projectionVersion: 1 },
      currentState: {
        chapter: 3,
        facts: facts.map(([subject, predicate, object, from, until]) => ({
          subject, predicate, object, validFromChapter: from, validUntilChapter: until, sourceChapter: from,
        })),
      },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [] },
    });

  it("returns L0 and L1 findings with ranges into the chapter text", async () => {
    const res = await lint({ bookId: BOOK, chapter: 3, text: CHAPTER });
    expect(res.status).toBe(200);
    const json = await res.json() as LintResponse;

    expect(json.sourceId).toBe("chapter:3");
    expect(json.ranges).toBeNull();
    expect(json.stateMissing).toBe(true);

    const typo = json.diagnostics.find((d) => d.ruleId === "mechanics/harper" && CHAPTER.slice(d.range!.start, d.range!.end) === "teh");
    expect(typo).toMatchObject({ layer: "mechanics", confidence: "deterministic", chapter: 3, range: { sourceId: "chapter:3" } });
    expect(typo!.fixes?.some((fix) => fix.replacement === "the")).toBe(true);
    expect(typo!.fingerprint).toMatch(/^[0-9a-f]{16}$/);

    const style = json.diagnostics.filter((d) => d.layer === "style");
    expect(style.length).toBeGreaterThan(0);
    for (const diagnostic of json.diagnostics) {
      expect(diagnostic.range!.end).toBeLessThanOrEqual(CHAPTER.length);
      expect(diagnostic.ruleId.startsWith("style/") || diagnostic.ruleId === "mechanics/harper").toBe(true);
    }
  });

  it("re-lints only the paragraphs it is given, reporting the expanded ranges", async () => {
    const start = CHAPTER.indexOf("She was");
    const res = await lint({ bookId: BOOK, chapter: 3, text: CHAPTER, ranges: [{ start: start + 3, end: start + 5 }] });
    const json = await res.json() as LintResponse;
    const end = CHAPTER.indexOf("dark.") + "dark.".length;

    expect(json.ranges).toEqual([{ start, end }]);
    expect(json.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of json.diagnostics) {
      expect(diagnostic.range!.start).toBeGreaterThanOrEqual(start);
      expect(diagnostic.range!.end).toBeLessThanOrEqual(end);
    }
  });

  it("accepts story names from the runtime state and adds the chapter's L3 findings without a range", async () => {
    await saveState([
      ["Mira", "status", "dead", 2, null],
      ["Mira", "location", "harbour", 3, null],
    ]);
    const json = await (await lint({ bookId: BOOK, chapter: 3, text: CHAPTER })).json() as LintResponse;

    expect(json.stateMissing).toBe(false);
    const spelled = json.diagnostics
      .filter((d) => d.range && d.ruleId === "mechanics/harper")
      .map((d) => CHAPTER.slice(d.range!.start, d.range!.end));
    expect(spelled).not.toContain("Mira");

    const continuity = json.diagnostics.filter((d) => d.layer === "continuity");
    expect(continuity.length).toBeGreaterThan(0);
    for (const diagnostic of continuity) {
      expect(diagnostic.range).toBeUndefined();
      expect(diagnostic.chapter).toBe(3);
    }
  });

  it("applies instance and rule suppressions saved through the suppression route", async () => {
    const first = await (await lint({ bookId: BOOK, chapter: 3, text: CHAPTER })).json() as LintResponse;
    const typo = first.diagnostics.find((d) => d.range && CHAPTER.slice(d.range.start, d.range.end) === "teh")!;
    const app = createStudioServer({} as never, root);

    const saved = await app.request("/api/v1/plotlint/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: BOOK, ruleId: typo.ruleId, fingerprint: typo.fingerprint, reason: "dialect spelling", chapter: 3, quote: "teh" }),
    });
    expect(saved.status).toBe(200);
    const file = JSON.parse(await readFile(join(bookDir, "story", "plotlint", "suppressions.json"), "utf-8"));
    expect(file.suppressions).toEqual([expect.objectContaining({ kind: "instance", fingerprint: typo.fingerprint, reason: "dialect spelling" })]);

    const second = await (await lint({ bookId: BOOK, chapter: 3, text: CHAPTER })).json() as LintResponse;
    expect(second.suppressed).toBe(1);
    expect(second.diagnostics.map((d) => d.fingerprint)).not.toContain(typo.fingerprint);
    expect(second.diagnostics).toHaveLength(first.diagnostics.length - 1);

    // Rule-wide: no fingerprint turns the check off for the book.
    const styleRule = first.diagnostics.find((d) => d.layer === "style")!.ruleId;
    await app.request("/api/v1/plotlint/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: BOOK, ruleId: styleRule, reason: "house style allows it" }),
    });
    const third = await (await lint({ bookId: BOOK, chapter: 3, text: CHAPTER })).json() as LintResponse;
    expect(third.diagnostics.some((d) => d.ruleId === styleRule)).toBe(false);
    expect(third.suppressed).toBe(1 + first.diagnostics.filter((d) => d.ruleId === styleRule).length);
  });

  it("finds no L0 or L1 problems in a Chinese chapter", async () => {
    const text = "# 第三章\n\n陈雨声走到码头，夜色很深。\n\n他非常非常累，但还是打开了那本旧笔记。";
    const json = await (await lint({ bookId: BOOK, chapter: 3, text })).json() as LintResponse;
    expect(json.diagnostics.filter((d) => d.layer === "mechanics" || d.layer === "style")).toEqual([]);
  });

  it("rejects bad requests and unknown books", async () => {
    expect((await lint({ bookId: BOOK, chapter: 3 })).status).toBe(400);
    expect((await lint({ bookId: BOOK, chapter: 3, text: "abc", ranges: [{ start: 2, end: 9 }] })).status).toBe(400);
    expect((await lint({ bookId: "../etc", chapter: 3, text: "abc" })).status).toBe(400);
    expect((await lint({ bookId: "missing-book", chapter: 3, text: "abc" })).status).toBe(404);

    const app = createStudioServer({} as never, root);
    const noReason = await app.request("/api/v1/plotlint/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: BOOK, ruleId: "mechanics/harper", reason: "  " }),
    });
    expect(noReason.status).toBe(400);
  });
});
