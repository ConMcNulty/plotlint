import { z } from "zod";
import { ObservationSchema } from "@actalk/inkos-core";

/** Check layers, ordered from most to least objective (see docs/plotlint/PLAN.md). */
export const DiagnosticLayerSchema = z.enum([
  "mechanics",
  "style",
  "metrics",
  "continuity",
  "structure",
  "judgment",
]);
export type DiagnosticLayer = z.infer<typeof DiagnosticLayerSchema>;

export const DiagnosticSeveritySchema = z.enum(["error", "warning", "note"]);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeveritySchema>;

/**
 * How sure a finding is: proved by code from text or state, checked by code over
 * facts an LLM extracted, or an LLM/rubric opinion.
 */
export const DiagnosticConfidenceSchema = z.enum(["deterministic", "extracted", "judged"]);
export type DiagnosticConfidence = z.infer<typeof DiagnosticConfidenceSchema>;

/** A character range in one source, filled once the settler records evidence spans. */
export const DiagnosticRangeSchema = z.object({
  sourceId: z.string().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
}).strict().refine((range) => range.end >= range.start, { message: "range end precedes start" });
export type DiagnosticRange = z.infer<typeof DiagnosticRangeSchema>;

/** A state fact a finding rests on, so the editor can jump to where it was established. */
export const DiagnosticFactRefSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  validFromChapter: z.number().int().min(0),
  validUntilChapter: z.number().int().min(0).nullable(),
  sourceChapter: z.number().int().min(0),
}).strict();
export type DiagnosticFactRef = z.infer<typeof DiagnosticFactRefSchema>;

/** A quick fix: replace the diagnostic's range with `replacement` (empty string deletes it). */
export const DiagnosticFixSchema = z.object({
  title: z.string().min(1),
  replacement: z.string(),
}).strict();
export type DiagnosticFix = z.infer<typeof DiagnosticFixSchema>;

export const DiagnosticSchema = ObservationSchema.extend({
  ruleId: z.string().min(1),
  layer: DiagnosticLayerSchema,
  severity: DiagnosticSeveritySchema,
  confidence: DiagnosticConfidenceSchema,
  chapter: z.number().int().min(0).optional(),
  range: DiagnosticRangeSchema.optional(),
  facts: z.array(DiagnosticFactRefSchema).optional(),
  fixes: z.array(DiagnosticFixSchema).optional(),
}).strict().refine(
  // Judged findings are notes only; they never block on their own.
  (diagnostic) => diagnostic.confidence !== "judged" || diagnostic.severity === "note",
  { message: "judged diagnostics must have severity note" },
).refine(
  (diagnostic) => diagnostic.evidence.length > 0 || (diagnostic.sourceRefs?.length ?? 0) > 0 || (diagnostic.facts?.length ?? 0) > 0,
  { message: "a diagnostic needs evidence, a source quote or a fact reference" },
).refine(
  (diagnostic) => !diagnostic.fixes?.length || diagnostic.range !== undefined,
  { message: "a diagnostic with fixes needs a range to apply them to" },
);
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

const severityRank: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, note: 2 };

/** Errors first, then warnings, then notes; within a severity, by chapter then rule. */
export function sortDiagnostics(diagnostics: ReadonlyArray<Diagnostic>): Diagnostic[] {
  return [...diagnostics].sort((a, b) =>
    severityRank[a.severity] - severityRank[b.severity]
    || (a.chapter ?? 0) - (b.chapter ?? 0)
    || a.ruleId.localeCompare(b.ruleId));
}

/** One line per diagnostic, in the style of a compiler: `ch12 warning continuity/dead-entity-acts: ...`. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const where = diagnostic.chapter === undefined ? "book" : `ch${diagnostic.chapter}`;
  const head = `${where} ${diagnostic.severity} ${diagnostic.ruleId} [${diagnostic.confidence}]: ${diagnostic.summary}`;
  return [head, ...diagnostic.evidence.map((line) => `    ${line}`)].join("\n");
}
