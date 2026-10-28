import type { Diagnostic } from "@plotlint/diagnostics";
import type { SceneAnnotation } from "../scene-annotations.js";
import type { Rule } from "../types.js";
import { annotatedScenes, chapterSpan, numberOption, structureFinding } from "./scene-structure.js";

// Stretches of the book where most scenes lack a goal or opposition. Chapters
// are judged in windows of `window` consecutive annotated chapters (default 5,
// the whole book when it is shorter); a window is flagged when more than
// `maxMissingShare` (default 0.5) of its scenes, and at least `minScenes`
// (default 4) scenes in all, lack one. Overlapping flagged windows are merged,
// and trimmed to chapters with an incomplete scene at either end, so one
// stretch gives one finding. A single scene without opposition is
// normal; a run of them is a sag.

type Part = "goal" | "opposition";
const PARTS: ReadonlyArray<Part> = ["goal", "opposition"];

const lacks = (scene: SceneAnnotation, part: Part) => scene[part] === null;
const incomplete = (scene: SceneAnnotation) => PARTS.some((part) => lacks(scene, part));

export const goalConflictOutcome: Rule = {
  id: "structure/goal-conflict-outcome",
  layer: "structure",
  title: "Scenes without goal or opposition",
  rationale: "In most scenes the viewpoint character wants something, meets opposition and ends somewhere new. A stretch where most scenes have no goal or nothing in the way tends to lose the reader, however good the prose.",
  source: "Dwight V. Swain, Techniques of the Selling Writer (1965), 'scene and sequel'; Jack M. Bickham, Scene and Structure (1993)",
  check({ book, options }) {
    const scenes = annotatedScenes(book);
    if (scenes.length === 0) return [];
    const window = Math.max(1, Math.round(numberOption(options, "window", 5)));
    const maxShare = numberOption(options, "maxMissingShare", 0.5);
    const minScenes = Math.max(1, numberOption(options, "minScenes", 4));

    const chapterList = [...new Set(scenes.map((scene) => scene.chapter))];
    const byChapter = (from: number, to: number) => scenes.filter((scene) => scene.chapter >= from && scene.chapter <= to);
    const flagged = (list: SceneAnnotation[]) => {
      const missing = list.filter(incomplete).length;
      return missing >= minScenes && missing / list.length > maxShare;
    };

    // Flagged windows as [first index, last index] into chapterList, merged when they overlap.
    const spans: Array<[number, number]> = [];
    const size = Math.min(window, chapterList.length);
    for (let i = 0; i + size <= chapterList.length; i += 1) {
      if (!flagged(byChapter(chapterList[i]!, chapterList[i + size - 1]!))) continue;
      const last = spans[spans.length - 1];
      if (last && i <= last[1]) last[1] = i + size - 1;
      else spans.push([i, i + size - 1]);
    }

    const diagnostics: Diagnostic[] = [];
    for (let [a, b] of spans) {
      // A merged stretch starts and ends at chapters that have an incomplete scene.
      const hasGap = (index: number) => byChapter(chapterList[index]!, chapterList[index]!).some(incomplete);
      while (a < b && !hasGap(a)) a += 1;
      while (b > a && !hasGap(b)) b -= 1;
      const from = chapterList[a]!;
      const to = chapterList[b]!;
      const list = byChapter(from, to);
      const counts = PARTS.map((part) => ({ part, count: list.filter((scene) => lacks(scene, part)).length }))
        .filter((entry) => entry.count > 0)
        .sort((x, y) => y.count - x.count);
      const [head, ...rest] = counts;
      const summary = `No ${head!.part} in ${head!.count} of ${list.length} scenes in ${chapterSpan(from, to)}`
        + rest.map((entry) => `; no ${entry.part} in ${entry.count}`).join("") + ".";
      diagnostics.push(structureFinding(this, {
        chapter: from,
        summary,
        evidence: list.filter(incomplete).map((scene) => `${scene.id}: ${PARTS.filter((part) => lacks(scene, part)).map((part) => `no ${part}`).join(", ")}${scene.goal ? ` (goal: ${scene.goal})` : ""}`),
      }));
    }
    return diagnostics;
  },
};
