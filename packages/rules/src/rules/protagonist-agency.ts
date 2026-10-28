import type { SceneAnnotation } from "../scene-annotations.js";
import type { Rule } from "../types.js";
import { annotatedScenes, numberOption, percent, structureFinding } from "./scene-structure.js";

// Who drives the plot: the share of turning points the protagonist causes. The
// protagonist is `protagonist` in scenes.json, else the most frequent POV
// character. A turning point counts for the protagonist when its `by` names
// them, or, with no `by`, when the annotator said "protagonist"; chance and
// circumstance never count. Flags a book with at least `minTurningPoints`
// (default 5) turning points where the protagonist causes less than `minShare`
// (default 0.3) of them.

const key = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[\s·・.'’-]+/gu, " ").trim();

/** "Mira" names "Mira Okonkwo-Hale" and the other way round: one is the other's whole words. */
export function sameCharacter(a: string, b: string): boolean {
  const x = key(a);
  const y = key(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  // CJK names have no spaces: "林" is not 林黛玉, but a two-character given name inside the full name is.
  if (!/\s/u.test(long) && /[㐀-鿿]/u.test(long)) return short.length >= 2 && long.includes(short);
  return ` ${long} `.includes(` ${short} `);
}

/**
 * The protagonist: the file's, else the most frequent POV character, counting
 * "Mira" and "Mira Okonkwo-Hale" as one (the first spelling seen names them).
 */
export function protagonistOf(scenes: ReadonlyArray<SceneAnnotation>, declared?: string): string | null {
  if (declared) return declared;
  const counts: Array<{ name: string; count: number }> = [];
  for (const scene of scenes) {
    if (!scene.pov) continue;
    const entry = counts.find((candidate) => sameCharacter(candidate.name, scene.pov!));
    if (entry) entry.count += 1;
    else counts.push({ name: scene.pov, count: 1 });
  }
  let best: { name: string; count: number } | null = null;
  for (const entry of counts) if (!best || entry.count > best.count) best = entry;
  return best?.name ?? null;
}

export const protagonistAgency: Rule = {
  id: "structure/protagonist-agency",
  layer: "structure",
  title: "Protagonist agency",
  rationale: "Readers follow a protagonist who makes things happen. When most of the story's turning points are done to the protagonist, by others or by chance, the protagonist reads as a passenger in their own story.",
  source: "K. M. Weiland, Creating Character Arcs (2016); Lisa Cron, Story Genius (2016), 'the protagonist must drive the plot'",
  check({ book, options }) {
    const scenes = annotatedScenes(book);
    const turns = scenes.filter((scene) => scene.turningPoint !== null);
    const minTurns = numberOption(options, "minTurningPoints", 5);
    if (turns.length === 0 || turns.length < minTurns) return [];
    const protagonist = protagonistOf(scenes, book?.scenes?.protagonist);
    if (!protagonist) return [];
    const minShare = numberOption(options, "minShare", 0.3);

    const byProtagonist = (scene: SceneAnnotation) => {
      const turn = scene.turningPoint!;
      if (turn.causedBy === "circumstance") return false;
      if (!turn.by || /^(?:the )?(?:protagonist|pov character|主角)$/iu.test(turn.by.trim())) return turn.causedBy === "protagonist";
      return sameCharacter(turn.by, protagonist);
    };
    const caused = turns.filter(byProtagonist).length;
    const share = caused / turns.length;
    if (share >= minShare) return [];
    return [structureFinding(this, {
      summary: `${protagonist} causes ${caused} of ${turns.length} turning points (${percent(share)}); the rest are done to them by others or by circumstance.`,
      evidence: turns.map((scene) => {
        const turn = scene.turningPoint!;
        return `${scene.id}: ${turn.description} (${byProtagonist(scene) ? protagonist : turn.by ?? turn.causedBy})`;
      }),
    })];
  },
};
