import type { Rule } from "../types.js";
import { annotatedScenes, structureFinding } from "./scene-structure.js";

// Passages the annotator reported as outside the scene's viewpoint: another
// character's unspoken thoughts, or events the POV character cannot perceive.
// They are the annotator's judgment, so they are notes, ranged at the passage.
// Deliberate head-hopping or an omniscient narrator are reasons to turn the rule
// off in rules.json.

export const povDiscipline: Rule = {
  id: "structure/pov-discipline",
  layer: "structure",
  title: "Viewpoint breaks",
  rationale: "A scene told from one character's viewpoint can only report what that character perceives, knows or infers. Narration that slips into another character's head, or reports what the viewpoint character cannot see, breaks the reader's footing in the scene.",
  source: "Renni Browne and Dave King, Self-Editing for Fiction Writers (2nd ed., 2004), ch. 3 'Point of View'",
  check({ book, chapters }) {
    return annotatedScenes(book).flatMap((scene) => (scene.povBreaks ?? []).map((entry) => structureFinding(this, {
      confidence: "judged",
      summary: `Possible viewpoint break in ${scene.id}${scene.pov ? ` (POV: ${scene.pov})` : ""}: ${entry.note}`,
      evidence: [`"${entry.quote}"`],
      at: { scene, quote: entry.quote },
      ...(chapters ? { chapters } : {}),
    })));
  },
};
