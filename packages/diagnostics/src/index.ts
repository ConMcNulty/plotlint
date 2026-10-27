import { z } from "zod";
import { CurrentStateFactSchema, ObservationSchema } from "@actalk/inkos-core";

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

/**
 * A state fact a finding rests on, so the editor can jump to where it was established.
 * Rules cite facts as the state stores them, with the settler's kind and evidence
 * passages, so this is the state's own fact schema rather than a copy that drifts.
 */
export const DiagnosticFactRefSchema = CurrentStateFactSchema;
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

/** Marking a check off for a whole book: every finding of `ruleId` is hidden. */
export const RuleSuppressionSchema = z.object({
  kind: z.literal("rule"),
  ruleId: z.string().min(1),
  reason: z.string().min(1),
  createdAt: z.string().min(1),
  author: z.string().min(1).optional(),
}).strict();
export type RuleSuppression = z.infer<typeof RuleSuppressionSchema>;

/** Marking one finding as intentional, matched by its fingerprint rather than its offsets. */
export const InstanceSuppressionSchema = z.object({
  kind: z.literal("instance"),
  ruleId: z.string().min(1),
  fingerprint: z.string().min(1),
  reason: z.string().min(1),
  createdAt: z.string().min(1),
  author: z.string().min(1).optional(),
  chapter: z.number().int().min(0).optional(),
  /** The flagged text or summary, so a human reading the file can tell what was suppressed. */
  quote: z.string().optional(),
}).strict();
export type InstanceSuppression = z.infer<typeof InstanceSuppressionSchema>;

export const SuppressionSchema = z.discriminatedUnion("kind", [RuleSuppressionSchema, InstanceSuppressionSchema]);
export type Suppression = z.infer<typeof SuppressionSchema>;

/** The per-book suppressions file, saved in the project so agents and the editor share it. */
export const SuppressionFileSchema = z.object({
  version: z.literal(1),
  suppressions: z.array(SuppressionSchema),
}).strict();
export type SuppressionFile = z.infer<typeof SuppressionFileSchema>;

const normalizeText = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim();

function utf8(input: string): number[] {
  const bytes: number[] = [];
  for (const char of input) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}

/** 64-bit FNV-1a over UTF-8, as 16 hex digits; deterministic in browsers and Node alike. */
function fnv1a64(input: string): string {
  // The 64-bit state is kept as four 16-bit limbs so plain number arithmetic stays exact.
  let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;
  for (const byte of utf8(input)) {
    h0 ^= byte;
    // Multiply by the FNV prime 2^40 + 0x1b3: 2^40 shifts limbs 0 and 1 up by 2 limbs and 8 bits.
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    const t2 = h2 * 0x1b3 + (t1 >>> 16) + (h0 << 8);
    const t3 = h3 * 0x1b3 + (t2 >>> 16) + (h1 << 8);
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  }
  return [h3, h2, h1, h0].map((limb) => limb.toString(16).padStart(4, "0")).join("");
}

/**
 * A stable id for one finding, for instance suppressions. It hashes the rule, the
 * chapter and the normalized evidence, quotes and facts, never character offsets,
 * so a suppression survives unrelated edits that move the text around.
 */
export function diagnosticFingerprint(diagnostic: Diagnostic): string {
  const parts = [
    diagnostic.ruleId,
    diagnostic.chapter === undefined ? "book" : `ch${diagnostic.chapter}`,
    ...diagnostic.evidence.map((line) => `e:${normalizeText(line)}`),
    ...(diagnostic.sourceRefs ?? []).map((ref) => `q:${normalizeText(ref.quote)}`),
    ...(diagnostic.facts ?? []).map((fact) =>
      `f:${normalizeText(fact.subject)}|${normalizeText(fact.predicate)}|${normalizeText(fact.object)}|${fact.validFromChapter}`),
  ];
  return fnv1a64(parts.join("\u0000"));
}

export interface SuppressedDiagnostic {
  readonly diagnostic: Diagnostic;
  readonly suppression: Suppression;
}

/**
 * Split findings into those still shown and those a suppression hides. An instance
 * suppression wins over a rule suppression, since its reason is the more specific one.
 */
export function applySuppressions(
  diagnostics: ReadonlyArray<Diagnostic>,
  suppressions: ReadonlyArray<Suppression>,
): { kept: Diagnostic[]; suppressed: SuppressedDiagnostic[] } {
  const byRule = new Map<string, Suppression>();
  const byInstance = new Map<string, Suppression>();
  for (const suppression of suppressions) {
    const key = suppression.kind === "rule" ? suppression.ruleId : `${suppression.ruleId}\u0000${suppression.fingerprint}`;
    const index = suppression.kind === "rule" ? byRule : byInstance;
    if (!index.has(key)) index.set(key, suppression);
  }

  const kept: Diagnostic[] = [];
  const suppressed: SuppressedDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const instance = byInstance.size > 0
      ? byInstance.get(`${diagnostic.ruleId}\u0000${diagnosticFingerprint(diagnostic)}`)
      : undefined;
    const suppression = instance ?? byRule.get(diagnostic.ruleId);
    if (suppression) suppressed.push({ diagnostic, suppression });
    else kept.push(diagnostic);
  }
  return { kept, suppressed };
}
