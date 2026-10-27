import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    established?: { chapter: number; start: number; end: number; quote: string };
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

  it("runs the book's check packs and its rules.json over the text", async () => {
    const text = "An ancient evil stirred in the north. She was very tired.";
    const ruleIds = async () => ((await (await lint({ bookId: BOOK, chapter: 1, text })).json()) as LintResponse).diagnostics
      .filter((d) => d.layer === "style").map((d) => [d.ruleId, d.severity]);
    expect(await ruleIds()).toEqual([["style/general.Intensifiers", "note"]]);

    const plotlint = join(bookDir, "story", "plotlint");
    await mkdir(plotlint, { recursive: true });
    await writeFile(join(plotlint, "packs.json"), JSON.stringify({ version: 1, packs: ["fantasy"] }));
    await writeFile(join(plotlint, "rules.json"), JSON.stringify({
      version: 1, rules: { "style/general.Intensifiers": "off", "style/fantasy.Cliches": "warning" },
    }));
    expect(await ruleIds()).toEqual([["style/fantasy.Cliches", "warning"]]);
  });

  it("lays the adaptive overlay from verdicts.jsonl between the packs and rules.json", async () => {
    const text = "An ancient evil stirred in the north. She was very tired.";
    const intensifiers = async () => ((await (await lint({ bookId: BOOK, chapter: 1, text })).json()) as LintResponse).diagnostics
      .filter((d) => d.ruleId === "style/general.Intensifiers").map((d) => d.severity);
    expect(await intensifiers()).toEqual(["note"]);

    // Fifteen standing rejections turn the rule off for this book; the cache sees the new file.
    const plotlint = join(bookDir, "story", "plotlint");
    await mkdir(plotlint, { recursive: true });
    const verdicts = Array.from({ length: 15 }, (_, index) => JSON.stringify({
      ruleId: "style/general.Intensifiers", fingerprint: `fp${index}`, verdict: "rejected", action: "not-useful",
      at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), layer: "style", confidence: "deterministic",
    }));
    await writeFile(join(plotlint, "verdicts.jsonl"), `${verdicts.join("\n")}\n`);
    expect(await intensifiers()).toEqual([]);

    // The author's own rules.json wins over what the verdicts implied.
    await writeFile(join(plotlint, "rules.json"), JSON.stringify({ version: 1, rules: { "style/general.Intensifiers": "warning" } }));
    expect(await intensifiers()).toEqual(["warning"]);
  });

  it("runs the L2 metrics only on whole-chapter lints, over the unsaved text", async () => {
    const plotlint = join(bookDir, "story", "plotlint");
    await mkdir(plotlint, { recursive: true });
    await writeFile(join(plotlint, "rules.json"), JSON.stringify({
      version: 1, rules: { "metrics/wall-of-text": { severity: "warning", options: { max: 12 } } },
    }));
    // A phrase in two saved chapters and the open chapter's unsaved text: repeated across chapters.
    const phrase = "the brass lantern swung above black water";
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0001_one.md"), `# One\n\nAt night ${phrase} again.\n`);
    await writeFile(join(bookDir, "chapters", "0002_two.md"), `# Two\n\nBy morning ${phrase} once more.\n`);
    const wall = "Rain fell on the roofs of the town while the carts rolled past the shuttered shops and the bells kept ringing for the dead.";
    const text = `# Three\n\nShe looked up: ${phrase} still.\n\n${wall}\n\n"Go," he said.`;

    const whole = await (await lint({ bookId: BOOK, chapter: 3, text })).json() as LintResponse;
    const metrics = whole.diagnostics.filter((d) => d.layer === "metrics");
    expect(metrics.map((d) => [d.ruleId, d.severity])).toEqual([
      ["metrics/repeated-phrase", "note"], ["metrics/wall-of-text", "warning"],
    ]);
    const repeated = metrics[0]!;
    expect(text.slice(repeated.range!.start, repeated.range!.end).toLowerCase()).toContain("brass lantern");
    expect(wall.startsWith(text.slice(metrics[1]!.range!.start, metrics[1]!.range!.end))).toBe(true);

    const start = text.indexOf("Rain");
    const partial = await (await lint({ bookId: BOOK, chapter: 3, text, ranges: [{ start, end: start + 4 }] })).json() as LintResponse;
    expect(partial.diagnostics.filter((d) => d.layer === "metrics")).toEqual([]);
  });

  it("points rangeless findings at where their first cited fact was established", async () => {
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0002_two.md"), "# Two\n\nMira died at dawn on the quay.\n");
    await saveRuntimeStateSnapshot(bookDir, {
      manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 3, projectionVersion: 1 },
      currentState: {
        chapter: 3,
        facts: [
          { subject: "Mira", predicate: "status", object: "dead", validFromChapter: 2, validUntilChapter: null, sourceChapter: 2, evidence: { quote: "Mira died at dawn" } },
          { subject: "Mira", predicate: "location", object: "harbour", validFromChapter: 3, validUntilChapter: null, sourceChapter: 3 },
        ],
      },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [] },
    });
    const json = await (await lint({ bookId: BOOK, chapter: 3, text: CHAPTER })).json() as LintResponse;
    const unranged = json.diagnostics.filter((d) => !d.range && d.layer === "continuity");
    expect(unranged.length).toBeGreaterThan(0);
    expect(unranged.map((d) => d.established)).toContainEqual(expect.objectContaining({ chapter: 2, quote: "Mira died at dawn" }));
    // The link is not part of the finding's identity.
    expect(json.diagnostics.every((d) => !d.range || d.established === undefined)).toBe(true);
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
