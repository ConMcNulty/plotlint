import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Diagnostic } from "@plotlint/diagnostics";
import {
  builtinRegistry, checkSnapshot, hookStatusRows, locateSceneQuote, SceneAnnotationsFileSchema, staleSceneAnnotations, type BookRuleData, type SceneAnnotationsFile,
} from "@plotlint/rules";
import { corpusRoot, loadCorpusBook, type CleanBook } from "@plotlint/rules/eval";
import { knownRuleIds, resolveBookPacks } from "../node.js";

// The lessing-fen corpus book (packages/rules/eval/corpus/lessing-fen): a
// 13-chapter, 39-scene mystery with a romantic subplot and known structure
// problems (PLANTED.md), settled, scene-annotated and hook-reconciled
// (story/plotlint/hooks.json) by glm-4.5-flash, read with the general, mystery and romance packs. These pin what the state rules say
// about it (scored in SCORE.md), so a change in any rule's findings shows here.

const dir = join(corpusRoot, "lessing-fen");
const extracted = join(dir, "extracted", "glm-4.5-flash");
let clean: CleanBook;
let snapshot: Parameters<typeof checkSnapshot>[0];
let scenes: SceneAnnotationsFile;
let book: BookRuleData;
let found: Diagnostic[];

beforeAll(async () => {
  clean = await loadCorpusBook("lessing-fen");
  const read = async (name: string) => JSON.parse(await readFile(join(extracted, name), "utf-8"));
  snapshot = {
    manifest: await read("manifest.json"),
    currentState: await read("current_state.json"),
    hooks: await read("hooks.json"),
    chapterSummaries: await read("chapter_summaries.json"),
  };
  scenes = SceneAnnotationsFileSchema.parse(await read("scenes.json"));
  const packs = resolveBookPacks(dir, clean.book, knownRuleIds());
  book = { ...clean.book, scenes, config: packs.config };
  found = checkSnapshot(snapshot, { rules: builtinRegistry.list(), chapters: clean.chapters, book });
});

const pinned = (rule: string) => found.filter((d) => d.ruleId === rule).map((d) => [d.chapter, d.severity]);

describe("the lessing-fen corpus book", () => {
  it("runs the general, mystery and romance packs on a finished 13-chapter book with 39 annotated scenes", () => {
    expect(clean.book.packs?.packs).toEqual(["mystery", "romance"]);
    expect(clean.chapters.size).toBe(13);
    expect(scenes.scenes).toHaveLength(39);
    expect(staleSceneAnnotations(scenes, clean.chapters)).toEqual([]);
    let given = 0;
    let located = 0;
    for (const scene of scenes.scenes) {
      for (const quote of [...Object.values(scene.evidence), scene.turningPoint?.evidence].filter((entry): entry is string => !!entry)) {
        given += 1;
        if (locateSceneQuote(scene, quote, clean.chapters)) located += 1;
      }
    }
    // Quotes not found in their scene are dropped when annotating, so every stored one is there.
    expect(located).toBe(given);
  });

  it("catches the dropped sister subplot (P1)", () => {
    expect(pinned("structure/subplot-balance")).toEqual([[5, "note"]]);
    expect(found.find((d) => d.ruleId === "structure/subplot-balance")!.summary).toBe(
      "The Bea Ashby subplot vanishes after ch5 (8 chapters before the end) with 1 question unresolved.",
    );
    expect(found.some((d) => d.ruleId === "structure/unpaid-setup" && /sister Bea/u.test(d.summary))).toBe(true);
  });

  it("catches the planted whistle (P2) through its hook, but not as an object that never returns", () => {
    expect(found.some((d) => d.ruleId === "structure/unpaid-setup" && /bosun's whistle/u.test(d.summary))).toBe(true);
    // The settler ended Nell's possession of it in ch10, and ch5's train whistle names it again.
    expect(found.some((d) => d.ruleId === "structure/unpaid-setup" && /never returns|has not returned/u.test(d.summary))).toBe(false);
  });

  it("catches the chapter where nothing changes (P3) by the cut test only", () => {
    expect(pinned("structure/cut-candidate")).toEqual([[8, "note"]]);
    // The annotator gave ch8's scenes small value changes and invented opposition.
    expect(pinned("structure/scene-turn")).toEqual([]);
    expect(pinned("structure/goal-conflict-outcome")).toEqual([]);
  });

  it("raises no continuity findings and no fair-play or romance warnings", () => {
    expect(found.filter((d) => d.layer === "continuity")).toEqual([]);
    for (const rule of ["structure/fair-play", "structure/hopeful-ending", "structure/central-relationship", "structure/both-leads-pov", "structure/unearned-payoff", "structure/open-questions", "structure/pov-discipline"]) {
      expect(pinned(rule), rule).toEqual([]);
    }
  });

  it("reads the ledger through the hook overlay: 21 of the 29 hooks it leaves open are answered later, with the passage", () => {
    const rows = hookStatusRows(snapshot, book.hooks, clean.chapters);
    const reconciled = rows.filter((row) => row.entry && row.entry.annotator !== "author");
    expect(reconciled).toHaveLength(29);
    expect(reconciled.filter((row) => row.stale)).toEqual([]);
    expect(rows.filter((row) => row.resolvedIn !== undefined)).toHaveLength(21);
    // The planted dropped subplot (P1) and whistle (P2) stay open.
    expect(rows.find((row) => row.id === "hook-4")).toMatchObject({ effective: "open" });
    expect(rows.find((row) => row.id === "hook-5")).toMatchObject({ effective: "open" });
    // The red herring's two hooks are closed by Silas's letter in ch9.
    expect(rows.filter((row) => row.id === "hook-17" || row.id === "hook-20").map((row) => row.resolvedIn)).toEqual([9, 9]);
  });

  it("pins the rest: 8 unresolved hooks, the agency and tension notes, one misspelt name", () => {
    expect(found.filter((d) => d.ruleId === "structure/unpaid-setup").map((d) => /hook (\S+) \(/u.exec(d.evidence[0] ?? "")?.[1])).toEqual([
      "hook-4", "hook-5", "hook-8", "hook-7", "hook-9", "hook-21", "hook-25", "hook-26",
    ]);
    expect(pinned("structure/unpaid-setup")).toEqual([
      [2, "warning"], [2, "warning"], [3, "warning"], [3, "warning"], [3, "warning"], [7, "warning"], [9, "warning"], [9, "warning"],
    ]);
    expect(found.find((d) => d.ruleId === "structure/protagonist-agency")).toMatchObject({
      severity: "note", summary: "Nell Ashby causes 7 of 36 turning points (19%); the rest are done to them by others or by circumstance.",
    });
    expect(found.find((d) => d.ruleId === "structure/tension-curve")).toMatchObject({
      severity: "note", chapter: 1, summary: "Tension stays flat across ch 1–6: stakes between 7 and 8 for 6 chapters.",
    });
    // A real slip of the drafting model: "Dorbit" once for Constable Dorrit (ch5).
    expect(found.find((d) => d.ruleId === "style/invented-term-spelling")).toMatchObject({ chapter: 5, summary: expect.stringMatching(/^"Dorbit" looks like a variant of "Dorrit"/u) });
    expect(found).toHaveLength(13);
  });
});
