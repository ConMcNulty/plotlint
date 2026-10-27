import { z } from "zod";
import { locateQuote } from "@actalk/inkos-core";
import { segmentScenes, type Scene } from "./scenes.js";
import type { ChapterTexts } from "./evidence.js";

// Scene annotations: the light per-scene record the structural checks (L4) read,
// saved in `story/plotlint/scenes.json`. An LLM fills them in (scene-annotate.ts),
// and the author may correct any entry by setting its annotator to "author";
// re-annotating never overwrites those. Every quote is a passage of the scene's
// text, so a finding can point at it. Browser-safe.

const nullableText = z.string().min(1).nullable().default(null);

/** Where a scene's main value stands, from -2 (worst) to 2 (best), on one axis such as safety, love or status. */
export const SceneValueSchema = z.object({
  axis: z.string().min(1),
  value: z.number().int().min(-2).max(2),
}).strict();
export type SceneValue = z.infer<typeof SceneValueSchema>;

export const SceneOutcomeSchema = z.enum(["success", "failure", "mixed", "none"]);
export type SceneOutcome = z.infer<typeof SceneOutcomeSchema>;

/** The moment the scene turns, and who or what turned it. */
export const TurningPointSchema = z.object({
  description: z.string().min(1),
  /** The protagonist's own choice, another character's, or chance and circumstance. */
  causedBy: z.enum(["protagonist", "other", "circumstance"]),
  /** Who caused it, by name. */
  by: z.string().min(1).optional(),
  /** A passage of the scene showing the turn. */
  evidence: z.string().min(1),
}).strict();
export type TurningPoint = z.infer<typeof TurningPointSchema>;

/** A passage that reports what the POV character cannot know or perceive. */
export const PovBreakSchema = z.object({
  quote: z.string().min(1),
  note: z.string().min(1),
}).strict();
export type PovBreak = z.infer<typeof PovBreakSchema>;

/** "author" for an entry the author wrote or corrected; `llm@<model>` for one a model wrote. */
export const AnnotatorSchema = z.string().regex(/^(?:author|llm@\S+)$/u, "annotator is \"author\" or \"llm@<model>\"");

export const SceneAnnotationSchema = z.object({
  /** `ch<chapter>.s<n>`, as `segmentScenes` numbers scenes. */
  id: z.string().regex(/^ch\d+\.s\d+$/u),
  chapter: z.number().int().min(0),
  scene: z.number().int().min(1),
  pov: nullableText,
  goal: nullableText,
  opposition: nullableText,
  outcome: SceneOutcomeSchema.nullable().default(null),
  valueStart: SceneValueSchema.nullable().default(null),
  valueEnd: SceneValueSchema.nullable().default(null),
  turningPoint: TurningPointSchema.nullable().default(null),
  /** How much the POV character stands to lose, 0 (nothing) to 10 (everything). */
  stakes: z.number().int().min(0).max(10).nullable().default(null),
  povBreaks: z.array(PovBreakSchema).optional(),
  /** Passages showing the goal, the opposition and the outcome. */
  evidence: z.object({
    goal: z.string().min(1).optional(),
    opposition: z.string().min(1).optional(),
    outcome: z.string().min(1).optional(),
  }).strict().default({}),
  annotator: AnnotatorSchema,
  /** `sceneHash` of the scene's text when it was annotated, so re-runs skip unchanged scenes. */
  sceneHash: z.string().min(1).optional(),
}).strict().refine((entry) => entry.id === `ch${entry.chapter}.s${entry.scene}`, { message: "id must be ch<chapter>.s<scene>" });
export type SceneAnnotation = z.infer<typeof SceneAnnotationSchema>;
export type SceneAnnotationInput = z.input<typeof SceneAnnotationSchema>;

/** `scenes.json`. */
export const SceneAnnotationsFileSchema = z.object({
  version: z.literal(1),
  /** The protagonist, for structure/protagonist-agency; the most frequent POV character when absent. */
  protagonist: z.string().min(1).optional(),
  scenes: z.array(SceneAnnotationSchema).default([]),
}).strict();
export type SceneAnnotationsFile = z.infer<typeof SceneAnnotationsFileSchema>;

/** A scene's prose, after its break line, with line endings normalised. */
export function sceneBody(text: string, scene: Scene): string {
  return text.slice(scene.bodyStart, scene.end).replace(/\r\n?/gu, "\n");
}

/** A short stable hash of a scene's prose (53-bit cyrb53, hex), ignoring line endings and surrounding blank space. */
export function sceneHash(body: string): string {
  const input = body.replace(/\r\n?/gu, "\n").trim();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Story order: by chapter, then scene. */
export const sceneOrder = (a: Pick<SceneAnnotation, "chapter" | "scene">, b: Pick<SceneAnnotation, "chapter" | "scene">) =>
  a.chapter - b.chapter || a.scene - b.scene;

/**
 * Merge freshly annotated entries into a file's scenes. Entries the author wrote
 * or corrected always win; `replaceChapters` are chapters that were re-annotated,
 * whose model entries for scenes that no longer exist are dropped.
 */
export function mergeSceneAnnotations(
  existing: ReadonlyArray<SceneAnnotation>,
  fresh: ReadonlyArray<SceneAnnotation>,
  replaceChapters: Iterable<number> = [],
): SceneAnnotation[] {
  const replaced = new Set(replaceChapters);
  const byId = new Map<string, SceneAnnotation>();
  for (const entry of existing) {
    if (replaced.has(entry.chapter) && entry.annotator !== "author") continue;
    byId.set(entry.id, entry);
  }
  for (const entry of fresh) {
    if (byId.get(entry.id)?.annotator === "author") continue;
    byId.set(entry.id, entry);
  }
  return [...byId.values()].sort(sceneOrder);
}

// Segmentation per chapter text, so rules over many scenes segment each chapter once.
const sceneCache = new WeakMap<ChapterTexts, Map<number, { text: string; scenes: Scene[] }>>();
function scenesOf(chapters: ChapterTexts, chapter: number): Scene[] {
  let byChapter = sceneCache.get(chapters);
  if (!byChapter) sceneCache.set(chapters, byChapter = new Map());
  const text = chapters.get(chapter) ?? "";
  let cached = byChapter.get(chapter);
  if (cached?.text !== text) byChapter.set(chapter, cached = { text, scenes: segmentScenes(text, { chapter }) });
  return cached.scenes;
}

/**
 * Where an annotation's quote sits in today's chapter text: within its scene
 * when the scene still exists, otherwise anywhere in the chapter. Null when the
 * chapter is not available or the passage is gone.
 */
export function locateSceneQuote(
  annotation: Pick<SceneAnnotation, "id" | "chapter">,
  quote: string | undefined,
  chapters: ChapterTexts | undefined,
): { start: number; end: number } | null {
  if (!quote || !chapters) return null;
  const text = chapters.get(annotation.chapter);
  if (text === undefined) return null;
  const scene = scenesOf(chapters, annotation.chapter).find((entry) => entry.id === annotation.id);
  if (scene) {
    const span = locateQuote(text.slice(scene.start, scene.end), quote);
    if (span) return { start: scene.start + span.start, end: scene.start + span.end };
  }
  return locateQuote(text, quote);
}

/** Annotated scenes whose text changed since they were annotated (by model; author entries are the author's call). */
export function staleSceneAnnotations(file: SceneAnnotationsFile, chapters: ChapterTexts): SceneAnnotation[] {
  return file.scenes.filter((entry) => {
    if (!entry.sceneHash || entry.annotator === "author") return false;
    const text = chapters.get(entry.chapter);
    if (text === undefined) return false;
    const scene = scenesOf(chapters, entry.chapter).find((candidate) => candidate.id === entry.id);
    return !scene || sceneHash(sceneBody(text, scene)) !== entry.sceneHash;
  });
}
