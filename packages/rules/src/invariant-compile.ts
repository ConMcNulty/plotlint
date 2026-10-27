import { FactKindSchema } from "@actalk/inkos-core";
import { explainCheck, InvariantCheckSchema, InvariantIdSchema, type InvariantCheck } from "./invariants.js";

// Compiling an author's plain-language invariant into the check language of
// invariants.ts with an LLM. The model only proposes data: the reply is parsed,
// lightly repaired, validated with zod, and saved as "proposed" until the author
// approves it. The LLM call is injected, so this module needs no client and the
// tests use a fake.

export interface CompileMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** One chat completion: the messages in, the model's text out. */
export type CompleteFn = (messages: ReadonlyArray<CompileMessage>) => Promise<string>;

export interface CompileContext {
  /** Names of characters, places and items in the book's state, so the model uses the book's spellings. */
  readonly names?: ReadonlyArray<string>;
  /** The last chapter written so far. */
  readonly lastChapter?: number;
}

export interface CompiledInvariant {
  readonly id: string;
  readonly check: InvariantCheck;
  /** `explainCheck(check)`: what will actually run, in plain words. */
  readonly explanation: string;
  /** How many model calls it took (2 when the first reply had to be repaired). */
  readonly attempts: number;
}

const SYSTEM = `You compile a novelist's plain-language rule about their own book into a JSON check that a program runs over the book.

The program sees two things:
1. Facts extracted from each chapter: { subject, predicate, object, validFromChapter, validUntilChapter }, free-form English or Chinese, e.g. "Mira · knows · Captain Voss is her father" (knowledge), "Mira · location · the harbour" (location), "Mira · holds · brass key" (possession), "Harrow · status · dead". A fact is in force from validFromChapter until validUntilChapter (null = still in force).
   Each fact may have a kind: ${FactKindSchema.options.join(", ")}.
2. The chapter text itself.

Reply with one JSON object and nothing else:
{ "id": "<short-kebab-case-id>", "check": <check> }

A check is one of:
- { "kind": "never", "fact": <pattern>, "from"?: <chapter>, "until"?: <chapter> }   no matching fact is ever in force (or none within from..until, inclusive)
- { "kind": "not-before", "fact": <pattern>, "chapter": <chapter> }   no matching fact is in force before that chapter
- { "kind": "not-after", "fact": <pattern>, "chapter": <chapter> }    no matching fact is in force after that chapter
- { "kind": "requires-before", "fact": <pattern>, "requires": <pattern>, "sameSubject"?: true, "strict"?: true }   every matching fact needs a "requires" fact established earlier (the same chapter counts unless strict)
- { "kind": "text-not-before", "text": { "contains": ["phrase", ...] } | { "regex": "..." }, "chapter": <chapter> }   the phrase does not appear in the chapter text before that chapter; use this for what the READER sees or is told, not for what characters know
- { "kind": "unsupported", "reason": "<why>" }   when the rule cannot be checked from facts or exact phrases (judgments about honesty, tone, motive, quality)

<chapter> is a chapter number or "last" (the finale / the last chapter).
<pattern> matches a fact; every field given must match, give at least one:
{ "subject"?: <match>, "predicate"?: <match>, "object"?: <match>, "kind"?: "<kind>" | ["<kind>", ...] }
<match> is "Exact Name" (case-insensitive) | { "equals": ["name", "alias", ...] } | { "contains": ["word", ...] } (case-insensitive substring, any) | { "regex": "..." } (case-insensitive)

Guidance:
- Prefer "kind" plus broad "contains" word lists over exact predicates: extracted predicates vary ("knows", "learned", "discovered", "is aware that").
- Use "equals" with every name a character goes by. Add Chinese words when the book is in Chinese.
- "before chapter N" means chapters 1..N-1. "until the finale" means before "last".
- Never guess a check for a rule you cannot express; say unsupported.

Examples:
Rule: "Ana never leaves the island before chapter 5"
{ "id": "ana-island-before-5", "check": { "kind": "not-before", "fact": { "subject": "Ana", "kind": "location", "object": { "contains": ["mainland", "port", "ship", "boat"] } }, "chapter": 5 } }
Rule: "Nobody opens the black box before they find the key"
{ "id": "key-before-box", "check": { "kind": "requires-before", "fact": { "predicate": { "contains": ["open"] }, "object": { "contains": ["black box"] } }, "requires": { "kind": "possession", "object": { "contains": ["key"] } }, "sameSubject": true } }
Rule: "The word 'dragon' is not used until chapter 12"
{ "id": "no-dragon-before-12", "check": { "kind": "text-not-before", "text": { "contains": ["dragon"] }, "chapter": 12 } }
Rule: "Ana is always kind"
{ "id": "ana-always-kind", "check": { "kind": "unsupported", "reason": "Kindness is a judgment about behaviour, not a fact or a phrase the program can find." } }`;

/** The messages that ask a model to compile one invariant. */
export function invariantPrompt(text: string, context: CompileContext = {}): CompileMessage[] {
  const lines = [`Rule: ${JSON.stringify(text)}`];
  if (context.names?.length) lines.push(`Names in this book's facts: ${context.names.slice(0, 80).join(", ")}`);
  if (context.lastChapter !== undefined) lines.push(`Chapters written so far: ${context.lastChapter}`);
  return [{ role: "system", content: SYSTEM }, { role: "user", content: lines.join("\n") }];
}

/** The first balanced JSON object in a reply, skipping reasoning blocks and code fences. */
export function extractJson(reply: string): string | null {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/giu, "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === "\"") inString = false;
    } else if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

const KIND_ALIASES: Record<string, string> = { notbefore: "not-before", notafter: "not-after", requiresbefore: "requires-before", textnotbefore: "text-not-before" };
const LAST = /^(last|finale|final|end|the ?last ?chapter|last ?chapter|the ?finale|最后一章|结局|大结局|终章)$/iu;

// Small slips models make that have only one sensible reading: "not_before",
// "20" for 20, "finale" for "last", a bare string where a list goes.
function repair(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => repair(item));
  if (value === null || typeof value !== "object") {
    if (typeof value !== "string") return value;
    if (key === "kind") {
      const squashed = value.toLowerCase().replace(/[\s_-]+/gu, "");
      return KIND_ALIASES[squashed] ?? value.toLowerCase();
    }
    if (key === "chapter" || key === "from" || key === "until") {
      if (/^\s*\d+\s*$/u.test(value)) return Number(value);
      if (LAST.test(value.trim())) return "last";
    }
    if (key === "contains" || key === "equals") return [value];
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, repair(v, k)]));
}

export type ParseResult =
  | { readonly ok: true; readonly id?: string; readonly check: InvariantCheck }
  | { readonly ok: false; readonly error: string };

/** Parse a model's reply: `{ id, check }`, or a bare check. */
export function parseCompiledReply(reply: string): ParseResult {
  const json = extractJson(reply);
  if (json === null) return { ok: false, error: "the reply has no JSON object" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, error: `the JSON does not parse: ${(error as Error).message}` };
  }
  const object = repair(parsed) as Record<string, unknown>;
  const bare = typeof object.kind === "string";
  const check = InvariantCheckSchema.safeParse(bare ? object : object.check);
  if (!check.success) {
    const issues = check.error.issues.map((issue) => `${issue.path.join(".") || "check"}: ${issue.message}`).join("; ");
    return { ok: false, error: `the check is not valid: ${issues}` };
  }
  const id = !bare && InvariantIdSchema.safeParse(object.id).success ? object.id as string : undefined;
  return { ok: true, check: check.data, ...(id ? { id } : {}) };
}

/** A kebab-case id from the rule's words, e.g. "mira-must-not-learn-the-captains-identity-before"; "invariant" when none are ASCII. */
export function invariantSlug(text: string): string {
  const slug = text.toLowerCase().replace(/['’]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (slug.length <= 48) return slug || "invariant";
  // Cut at a word boundary.
  const cut = slug.slice(0, 49).lastIndexOf("-");
  return slug.slice(0, cut > 0 ? cut : 48);
}

/**
 * Compile one invariant. A reply that does not validate is sent back once with
 * the problem, since models usually fix a schema slip when told what it was.
 */
export async function compileInvariant(
  text: string,
  complete: CompleteFn,
  context: CompileContext = {},
  options: { readonly attempts?: number } = {},
): Promise<CompiledInvariant> {
  const attempts = options.attempts ?? 2;
  const messages = invariantPrompt(text, context);
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const reply = await complete(messages);
    const result = parseCompiledReply(reply);
    if (result.ok) {
      return { id: result.id ?? invariantSlug(text), check: result.check, explanation: explainCheck(result.check), attempts: attempt };
    }
    lastError = result.error;
    messages.push(
      { role: "assistant", content: reply },
      { role: "user", content: `That reply could not be used: ${result.error}. Reply again with only the corrected JSON object.` },
    );
  }
  throw new Error(`Could not compile the invariant after ${attempts} attempts: ${lastError}`);
}
