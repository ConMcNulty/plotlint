import type { Diagnostic } from "@plotlint/diagnostics";
import type { SceneAnnotation } from "../scene-annotations.js";
import type { Rule } from "../types.js";
import { annotatedScenes, anyQuote, numberOption, sceneSpan, structureFinding } from "./scene-structure.js";

// Runs of consecutive scenes that end where they began: the same value on the
// same axis at the start and the end. A scene with no values recorded breaks a
// run, since nothing says it is flat. Option `minRun` (default 3) is the
// shortest run reported; one flat scene, or two, is often a breather.

const axisKey = (axis: string) => axis.trim().toLowerCase();

/** The scene's value does not move: same axis, same value at both ends. */
export function isFlat(scene: SceneAnnotation): boolean {
  const { valueStart: start, valueEnd: end } = scene;
  return !!start && !!end && axisKey(start.axis) === axisKey(end.axis) && start.value === end.value;
}

export const sceneTurn: Rule = {
  id: "structure/scene-turn",
  layer: "structure",
  title: "Scenes that do not turn",
  rationale: "A scene should change something: the value at stake for its viewpoint character (safety, love, status, knowledge) should end somewhere other than where it began. A run of scenes that end where they started usually reads as marking time.",
  source: "Robert McKee, Story (1997), ch. 2 and 'The Scene'; Shawn Coyne, The Story Grid (2015), 'the scene must turn'",
  check({ book, chapters, options }) {
    const scenes = annotatedScenes(book);
    const minRun = Math.max(1, numberOption(options, "minRun", 3));
    const diagnostics: Diagnostic[] = [];
    let run: SceneAnnotation[] = [];
    const flush = () => {
      if (run.length >= minRun) {
        const first = run[0]!;
        const last = run[run.length - 1]!;
        diagnostics.push(structureFinding(this, {
          summary: `Scenes ${sceneSpan(first, last)} end where they began: ${run.length} scenes in a row with no change in their value.`,
          evidence: run.map((scene) => `${scene.id}: ${scene.valueStart!.axis} ${scene.valueStart!.value} → ${scene.valueEnd!.value}${scene.outcome ? `, outcome ${scene.outcome}` : ""}`),
          at: { scene: first, quote: anyQuote(first) },
          chapter: first.chapter,
          ...(chapters ? { chapters } : {}),
        }));
      }
      run = [];
    };
    for (const scene of scenes) {
      if (isFlat(scene)) run.push(scene);
      else flush();
    }
    flush();
    return diagnostics;
  },
};
