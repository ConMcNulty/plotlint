import type { Diagnostic } from "@plotlint/diagnostics";
import type { ChapterTexts } from "../evidence.js";
import { locateSceneQuote, sceneOrder, type SceneAnnotation } from "../scene-annotations.js";
import type { BookRuleData } from "../book.js";
import type { Rule } from "../types.js";

// Shared pieces of the structure rules over scene annotations (`scenes.json`).

/** The book's annotated scenes in story order; empty when there are none. */
export const annotatedScenes = (book: BookRuleData | undefined): SceneAnnotation[] =>
  [...(book?.scenes?.scenes ?? [])].sort(sceneOrder);

/** A numeric option, or the default when it is absent or not a finite number. */
export function numberOption(options: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** "ch14.s1 to ch17.s1", or the one id. */
export const sceneSpan = (first: SceneAnnotation, last: SceneAnnotation) => (first.id === last.id ? first.id : `${first.id} to ${last.id}`);

/** "ch 10–14", or "ch 10". */
export const chapterSpan = (first: number, last: number) => (first === last ? `ch ${first}` : `ch ${first}–${last}`);

export const percent = (share: number) => `${Math.round(share * 100)}%`;

export interface StructureFindingInput {
  readonly summary: string;
  readonly evidence: ReadonlyArray<string>;
  readonly chapter?: number;
  readonly severity?: Diagnostic["severity"];
  readonly confidence?: "extracted" | "judged";
  /** A scene and one of its quotes to range the finding at, when the passage is still in the chapter. */
  readonly at?: { readonly scene: SceneAnnotation; readonly quote: string | undefined };
  readonly chapters?: ChapterTexts;
}

/**
 * A structure finding. Its confidence is "extracted" (code over an LLM's scene
 * annotations) or "judged" (the annotation itself is the opinion), and judged
 * findings are notes.
 */
export function structureFinding(rule: Pick<Rule, "id" | "layer">, input: StructureFindingInput): Diagnostic {
  const confidence = input.confidence ?? "extracted";
  const span = input.at ? locateSceneQuote(input.at.scene, input.at.quote, input.chapters) : null;
  const chapter = input.chapter ?? input.at?.scene.chapter;
  const sourceId = input.at ? `chapter:${input.at.scene.chapter}` : undefined;
  const quote = span && input.chapters ? input.chapters.get(input.at!.scene.chapter)!.slice(span.start, span.end) : undefined;
  return {
    code: rule.id.split("/").pop() ?? rule.id,
    ruleId: rule.id,
    layer: rule.layer,
    severity: confidence === "judged" ? "note" : input.severity ?? "warning",
    confidence,
    category: "quality",
    assessment: "issue",
    ...(chapter === undefined ? {} : { chapter }),
    summary: input.summary,
    evidence: [...input.evidence],
    ...(span && sourceId ? { range: { sourceId, start: span.start, end: span.end } } : {}),
    ...(quote && sourceId ? { sourceRefs: [{ sourceId, quote }] } : {}),
  };
}

/** The first quote an annotation has, for ranging a finding about the whole scene. */
export const anyQuote = (scene: SceneAnnotation): string | undefined =>
  scene.turningPoint?.evidence ?? scene.evidence.outcome ?? scene.evidence.goal ?? scene.evidence.opposition;
