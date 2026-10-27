import { z } from "zod";
import { FactKindSchema, type CurrentStateFact, type FactKind, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import { DiagnosticSeveritySchema } from "@plotlint/diagnostics";
import type { ChapterTexts } from "./evidence.js";
import { hasKind } from "./predicates.js";
import { normalize } from "./rules/facts.js";

// Author-written invariants ("story unit tests"): rules the author states in
// plain language, which an LLM compiles into a small declarative check that the
// author approves. The check is data that this module interprets, never code, so
// a compiled rule can only ask the questions below, and every one of them has a
// plain-words explanation generated from the check itself rather than from the
// model's account of what it wrote.
//
// Saved in `story/plotlint/invariants.json`:
//   { "version": 1, "invariants": [{ "id": "mira-captain-identity", "text": "...",
//     "status": "approved", "check": { "kind": "not-before", ... }, "explanation": "..." }] }

const MAX_PATTERN = 200;

const regexCompiles = (source: string) => {
  try {
    new RegExp(source, "iu");
    return true;
  } catch {
    return false;
  }
};

const RegexSchema = z.string().min(1).max(MAX_PATTERN).refine(regexCompiles, { message: "not a valid regular expression" });
const Words = z.array(z.string().min(1).max(MAX_PATTERN)).min(1);

/**
 * How one field of a fact is matched: a bare string is one exact name (compared
 * with `normalize`, so case, spaces, `_` and `-` do not matter); `equals` is any
 * of several exact names; `contains` any case-insensitive substring; `regex` a
 * case-insensitive regular expression.
 */
export const ValueMatchSchema = z.union([
  z.string().min(1).max(MAX_PATTERN),
  z.object({ equals: Words }).strict(),
  z.object({ contains: Words }).strict(),
  z.object({ regex: RegexSchema }).strict(),
]);
export type ValueMatch = z.infer<typeof ValueMatchSchema>;

/** A fact pattern: every field given must match. A kind matches by the settler's label or the predicate vocabulary. */
export const FactPatternSchema = z.object({
  subject: ValueMatchSchema.optional(),
  predicate: ValueMatchSchema.optional(),
  object: ValueMatchSchema.optional(),
  kind: z.union([FactKindSchema, z.array(FactKindSchema).min(1)]).optional(),
}).strict().refine((pattern) => Object.keys(pattern).length > 0, { message: "a fact pattern needs at least one field" });
export type FactPattern = z.infer<typeof FactPatternSchema>;

/** A phrase in the chapter text: any of several case-insensitive substrings, or a regular expression. */
export const TextPatternSchema = z.union([
  z.object({ contains: Words }).strict(),
  z.object({ regex: RegexSchema }).strict(),
]);
export type TextPattern = z.infer<typeof TextPatternSchema>;

/** A chapter number, or "last": the last chapter written so far (the finale, once the book is done). */
export const ChapterRefSchema = z.union([z.number().int().min(0), z.literal("last")]);
export type ChapterRef = z.infer<typeof ChapterRefSchema>;

export const InvariantCheckSchema = z.discriminatedUnion("kind", [
  /** No matching fact is ever in force, or none within `from`..`until` (inclusive). */
  z.object({ kind: z.literal("never"), fact: FactPatternSchema, from: ChapterRefSchema.optional(), until: ChapterRefSchema.optional() }).strict(),
  /** No matching fact is in force before `chapter`. */
  z.object({ kind: z.literal("not-before"), fact: FactPatternSchema, chapter: ChapterRefSchema }).strict(),
  /** No matching fact is in force after `chapter`. */
  z.object({ kind: z.literal("not-after"), fact: FactPatternSchema, chapter: ChapterRefSchema }).strict(),
  /**
   * Every fact matching `fact` needs a fact matching `requires` established earlier;
   * in the same chapter counts unless `strict`, since facts within a chapter have no order.
   * With `sameSubject`, the earlier fact must be about the same subject.
   */
  z.object({
    kind: z.literal("requires-before"),
    fact: FactPatternSchema,
    requires: FactPatternSchema,
    sameSubject: z.boolean().optional(),
    strict: z.boolean().optional(),
  }).strict(),
  /** The phrase does not appear in the chapter text before `chapter`. */
  z.object({ kind: z.literal("text-not-before"), text: TextPatternSchema, chapter: ChapterRefSchema }).strict(),
  /** The rule cannot be checked deterministically over facts and text ("Tomas never lies"). */
  z.object({ kind: z.literal("unsupported"), reason: z.string().min(1) }).strict(),
]);
export type InvariantCheck = z.infer<typeof InvariantCheckSchema>;
export type InvariantCheckKind = InvariantCheck["kind"];

export const InvariantIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u, "an invariant id is lowercase kebab-case, e.g. mira-captain-identity");

export const InvariantSchema = z.object({
  id: InvariantIdSchema,
  /** The author's rule in their own words, quoted in every finding. */
  text: z.string().min(1),
  /** Only approved invariants run; a compiled check waits as proposed until the author has read it. */
  status: z.enum(["proposed", "approved"]),
  check: InvariantCheckSchema,
  /** What the check does, in plain words (`explainCheck`). */
  explanation: z.string().min(1),
  /** The severity of its findings; "error" by default, since the author asked for it. */
  severity: DiagnosticSeveritySchema.optional(),
  createdAt: z.string().optional(),
  approvedAt: z.string().optional(),
}).strict();
export type Invariant = z.infer<typeof InvariantSchema>;

export const InvariantsFileSchema = z.object({
  version: z.literal(1),
  invariants: z.array(InvariantSchema).default([]),
}).strict().refine((file) => new Set(file.invariants.map((inv) => inv.id)).size === file.invariants.length, {
  message: "invariant ids must be unique",
});
export type InvariantsFile = z.infer<typeof InvariantsFileSchema>;

// --- matching ---

export function matchesValue(match: ValueMatch, value: string): boolean {
  if (typeof match === "string") return normalize(value) === normalize(match);
  if ("equals" in match) return match.equals.some((name) => normalize(name) === normalize(value));
  if ("contains" in match) {
    const text = value.toLowerCase();
    return match.contains.some((part) => text.includes(part.toLowerCase()));
  }
  return new RegExp(match.regex, "iu").test(value);
}

export function matchesFact(pattern: FactPattern, fact: CurrentStateFact): boolean {
  if (pattern.subject !== undefined && !matchesValue(pattern.subject, fact.subject)) return false;
  if (pattern.predicate !== undefined && !matchesValue(pattern.predicate, fact.predicate)) return false;
  if (pattern.object !== undefined && !matchesValue(pattern.object, fact.object)) return false;
  if (pattern.kind !== undefined) {
    const kinds: FactKind[] = Array.isArray(pattern.kind) ? pattern.kind : [pattern.kind];
    if (!kinds.some((kind) => hasKind(fact, kind))) return false;
  }
  return true;
}

/** Every occurrence of a text pattern in `text`, as offsets. */
export function findText(pattern: TextPattern, text: string): Array<{ start: number; end: number }> {
  const source = "regex" in pattern
    ? pattern.regex
    : pattern.contains.map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  const found: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(new RegExp(source, "giu"))) {
    // An empty match would repeat forever in an editor and means nothing to the author.
    if (match[0].length > 0) found.push({ start: match.index, end: match.index + match[0].length });
  }
  return found;
}

/** The last chapter written so far: the highest chapter in the text or the state. */
export function lastChapter(snapshot: RuntimeStateSnapshot, chapters?: ChapterTexts): number {
  let last = snapshot.manifest.lastAppliedChapter;
  for (const chapter of chapters?.keys() ?? []) last = Math.max(last, chapter);
  for (const fact of snapshot.currentState.facts) last = Math.max(last, fact.validFromChapter, fact.sourceChapter);
  return last;
}

export const resolveChapter = (ref: ChapterRef, last: number) => (ref === "last" ? last : ref);

// --- plain words ---

const quote = (value: string) => `"${value}"`;
const anyOf = (values: string[]) => values.length === 1 ? quote(values[0]!) : `any of ${values.map(quote).join(", ")}`;

function describeValue(match: ValueMatch): string {
  if (typeof match === "string") return `is ${quote(match)}`;
  if ("equals" in match) return `is ${anyOf(match.equals)}`;
  if ("contains" in match) return `contains ${anyOf(match.contains)}`;
  return `matches /${match.regex}/`;
}

/** A fact pattern in words: `a fact whose subject is "Mira", of kind knowledge, and whose object contains "captain"`. */
export function describePattern(pattern: FactPattern): string {
  const parts: string[] = [];
  if (pattern.subject !== undefined) parts.push(`whose subject ${describeValue(pattern.subject)}`);
  if (pattern.kind !== undefined) parts.push(`of kind ${(Array.isArray(pattern.kind) ? pattern.kind : [pattern.kind]).join(" or ")}`);
  if (pattern.predicate !== undefined) parts.push(`whose predicate ${describeValue(pattern.predicate)}`);
  if (pattern.object !== undefined) parts.push(`whose object ${describeValue(pattern.object)}`);
  return `a fact ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}`;
}

const describeChapter = (ref: ChapterRef) => (ref === "last" ? "the last chapter" : `chapter ${ref}`);

/**
 * What a check does, in plain words, generated from the check itself so the
 * author approves what will actually run rather than the model's summary of it.
 */
export function explainCheck(check: InvariantCheck): string {
  switch (check.kind) {
    case "never": {
      const range = check.from !== undefined && check.until !== undefined ? ` from ${describeChapter(check.from)} to ${describeChapter(check.until)}`
        : check.from !== undefined ? ` from ${describeChapter(check.from)} on`
        : check.until !== undefined ? ` up to ${describeChapter(check.until)}`
        : " in any chapter";
      return `Fails when ${describePattern(check.fact)} is in force${range}.`;
    }
    case "not-before":
      return `Fails when ${describePattern(check.fact)} is in force before ${describeChapter(check.chapter)}.`;
    case "not-after":
      return `Fails when ${describePattern(check.fact)} is in force after ${describeChapter(check.chapter)}.`;
    case "requires-before":
      return `Fails when ${describePattern(check.fact)} is established without ${describePattern(check.requires)}`
        + `${check.sameSubject ? " about the same subject" : ""} established ${check.strict ? "in an earlier chapter" : "earlier or in the same chapter"}.`;
    case "text-not-before": {
      const phrase = "regex" in check.text ? `text matching /${check.text.regex}/`
        : check.text.contains.length === 1 ? `the phrase ${quote(check.text.contains[0]!)}`
        : `any of the phrases ${check.text.contains.map(quote).join(", ")}`;
      return `Fails when ${phrase} appears in the chapter text before ${describeChapter(check.chapter)} (case-insensitive).`;
    }
    case "unsupported":
      return `Not checked: ${check.reason}`;
  }
}
