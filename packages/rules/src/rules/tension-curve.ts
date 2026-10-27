import type { Diagnostic } from "@plotlint/diagnostics";
import type { SceneAnnotation } from "../scene-annotations.js";
import type { Rule } from "../types.js";
import { isFinished } from "./structure/common.js";
import { annotatedScenes, anyQuote, chapterSpan, numberOption, percent, structureFinding } from "./scene-structure.js";

// The tension curve: each chapter's stakes, the highest of its scenes' judged
// stakes (0 to 10). Two shapes are flagged, as notes, since the stakes are the
// annotator's opinion:
// - a flat run: `flatRun` (default 5) or more consecutive annotated chapters
//   whose stakes stay within `flatBand` (default 1) of each other, in a book of
//   at least `minChapters` (default 8) annotated chapters (models tend to give
//   every scene of a short book much the same stakes);
// - an early peak, only once the book is finished (option `finished`, else
//   book.json's status "completed" or its target chapter count reached):
//   the last chapter at the highest stakes comes before `earlyPeak` (default
//   0.6) of the way through, in a book of at least `minChapters` annotated
//   chapters.

export interface ChapterTension {
  readonly chapter: number;
  readonly stakes: number;
  /** The scene with the highest stakes. */
  readonly scene: SceneAnnotation;
}

/** Per-chapter stakes in chapter order; chapters with no judged stakes are left out. */
export function tensionCurve(scenes: ReadonlyArray<SceneAnnotation>): ChapterTension[] {
  const byChapter = new Map<number, ChapterTension>();
  for (const scene of scenes) {
    if (scene.stakes === null) continue;
    const current = byChapter.get(scene.chapter);
    if (!current || scene.stakes > current.stakes) byChapter.set(scene.chapter, { chapter: scene.chapter, stakes: scene.stakes, scene });
  }
  return [...byChapter.values()].sort((a, b) => a.chapter - b.chapter);
}

const curveLine = (points: ReadonlyArray<ChapterTension>) => points.map((point) => `ch${point.chapter} ${point.stakes}`).join(", ");

export const tensionCurveRule: Rule = {
  id: "structure/tension-curve",
  layer: "structure",
  title: "Tension curve",
  rationale: "Pressure on the protagonist should build toward the climax, with rises and releases along the way. Long stretches at one level of stakes, or a peak well before the end, often leave the last part of a book feeling like an afterthought.",
  source: "Gustav Freytag, Die Technik des Dramas (1863); Robert McKee, Story (1997), 'progressive complications'",
  check(context) {
    const { book, chapters, options } = context;
    const curve = tensionCurve(annotatedScenes(book));
    if (curve.length === 0) return [];
    const flatRun = Math.max(2, numberOption(options, "flatRun", 5));
    const minChapters = numberOption(options, "minChapters", 8);
    const band = numberOption(options, "flatBand", 1);
    const diagnostics: Diagnostic[] = [];
    const located = chapters ? { chapters } : {};

    for (let i = 0; curve.length >= minChapters && i < curve.length;) {
      let low = curve[i]!.stakes;
      let high = low;
      let j = i + 1;
      while (j < curve.length) {
        const stakes = curve[j]!.stakes;
        if (Math.max(high, stakes) - Math.min(low, stakes) > band) break;
        low = Math.min(low, stakes);
        high = Math.max(high, stakes);
        j += 1;
      }
      if (j - i >= flatRun) {
        const run = curve.slice(i, j);
        diagnostics.push(structureFinding(this, {
          confidence: "judged",
          chapter: run[0]!.chapter,
          summary: `Tension stays flat across ${chapterSpan(run[0]!.chapter, run[run.length - 1]!.chapter)}: stakes ${low === high ? `at ${low}` : `between ${low} and ${high}`} for ${run.length} chapters.`,
          evidence: [`stakes: ${curveLine(run)}`],
          ...located,
        }));
        i = j;
      } else {
        i += 1;
      }
    }

    if (isFinished(context, curve[curve.length - 1]!.chapter) && curve.length >= minChapters) {
      const top = Math.max(...curve.map((point) => point.stakes));
      const index = curve.map((point) => point.stakes).lastIndexOf(top);
      const position = (index + 1) / curve.length;
      const earlyPeak = numberOption(options, "earlyPeak", 0.6);
      if (position < earlyPeak) {
        const peak = curve[index]!;
        diagnostics.push(structureFinding(this, {
          confidence: "judged",
          summary: `Peak tension is in ch ${peak.chapter} of ${curve.length} annotated chapters (${percent(position)} of the way through), and the stakes never return to it.`,
          evidence: [`stakes: ${curveLine(curve)}`],
          at: { scene: peak.scene, quote: anyQuote(peak.scene) },
          ...located,
        }));
      }
    }
    return diagnostics;
  },
};
