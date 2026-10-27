import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkSnapshot, locateSceneQuote, SceneAnnotationsFileSchema, staleSceneAnnotations, type SceneAnnotationsFile } from "../index.js";
import { corpusRoot, loadCorpusBook, type CleanBook } from "../eval/index.js";
import { snapshot } from "./fixtures.js";

// Scene annotations a real model wrote for the clean eval book (`inkos lint
// annotate`, cached in corpus/wenlow/extracted/). They pin what the structure
// rules say about a real annotation, with no network in the tests.

let clean: CleanBook;
let scenes: SceneAnnotationsFile;
beforeAll(async () => {
  clean = await loadCorpusBook("wenlow");
  const path = join(corpusRoot, "wenlow", "extracted", "glm-4.5-flash", "scenes.json");
  scenes = SceneAnnotationsFileSchema.parse(JSON.parse(await readFile(path, "utf-8")));
});

describe("real scene annotations of the clean book", () => {
  it("cover every scene, are current, and every quote is in its scene", () => {
    expect(scenes.scenes.map((scene) => scene.id)).toEqual(["ch1.s1", "ch2.s1", "ch3.s1", "ch4.s1", "ch5.s1"]);
    expect(staleSceneAnnotations(scenes, clean.chapters)).toEqual([]);
    for (const scene of scenes.scenes) {
      const quotes = [...Object.values(scene.evidence), scene.turningPoint?.evidence, ...(scene.povBreaks ?? []).map((entry) => entry.quote)];
      for (const quote of quotes.filter((entry): entry is string => !!entry)) {
        expect(locateSceneQuote(scene, quote, clean.chapters), `${scene.id}: ${quote}`).not.toBeNull();
      }
    }
  });

  it("raise only the agency warning and the omniscient aside in chapter 2", () => {
    const diagnostics = checkSnapshot(snapshot([], 5), { chapters: clean.chapters, book: { ...clean.book, scenes } })
      .filter((diagnostic) => diagnostic.layer === "structure");
    expect(diagnostics.map((d) => [d.ruleId, d.chapter, d.severity])).toEqual([
      ["structure/protagonist-agency", undefined, "warning"],
      ["structure/pov-discipline", 2, "note"],
    ]);
    expect(diagnostics[1]!.sourceRefs![0]!.quote).toMatch(/^Crane was at that moment in his cottage/u);
  });
});
