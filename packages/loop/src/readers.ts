import { z } from "zod";
import { locateQuote } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import { escapeStrayQuotes, extractJson, type CompileMessage } from "@plotlint/rules";
import type { Complete, Editor, EditorInput, Span } from "./types.js";

// The beta-reader panel: reader personas, set by the pack, who say where they were
// confused or bored, where they would stop, what they want more or less of, and what
// they expect next. Their notes are judged findings (severity note, never blocking),
// each anchored on a quote that must be found in the passage or the note is dropped.
// Personas and models rotate between rounds so the author agent can't tune itself to
// one judge (PLAN, "Rotating critics").

export interface ReaderPersona {
  /** kebab-case, used in rule codes and logs. */
  readonly name: string;
  /** Who this reader is, in a sentence or two, for the prompt. */
  readonly brief: string;
}

/** The general pack's panel: a genre fan, a skeptical reader and a newcomer to the genre. */
export const DEFAULT_READERS: ReadonlyArray<ReaderPersona> = [
  { name: "genre-fan", brief: "You read dozens of books a year in this genre. You know its conventions and notice when a scene skips the beats you came for or repeats ones you have seen too often." },
  { name: "skeptic", brief: "You are a skeptical reader. You notice when characters act without a reason, when coincidences do the plot's work, and when the prose tells you what to feel." },
  { name: "newcomer", brief: "You rarely read this genre. You get lost when names, places or rules arrive without enough context, and you lose interest when nothing is at stake." },
];

export const BETA_READER_RULE_ID = "judgment/beta-reader";

const KINDS = ["confused", "bored", "would-stop", "wants-more", "wants-less", "moved"] as const;

function system(persona: ReaderPersona): string {
  return `You are a beta reader giving honest, specific reactions to a passage from a novel in progress. ${persona.brief}

Report at most five reactions, only ones you really had. For each, quote the exact words (5 to 30 words, copied character for character from the passage) where it happened.
- "confused": you lost track of who, where, when or why.
- "bored": your attention drifted.
- "would-stop": you would put the book down here.
- "wants-more" / "wants-less": you wanted more or less of something; name it in "axis" as one word: description, dialogue, action, interiority, backstory or explanation.
- "moved": it worked on you. Reactions of this kind are kept but never sent back as problems.
Also say in one sentence what you expect to happen next.

Reply with one JSON object and nothing else:
{ "reactions": [ { "kind": "${KINDS.join("\" | \"")}", "quote": "<exact words>", "note": "<one sentence>", "axis": "<one word or null>" } ], "prediction": "<one sentence>" }`;
}

const ReplySchema = z.object({
  reactions: z.array(z.object({
    kind: z.enum(KINDS),
    quote: z.string(),
    note: z.string(),
    axis: z.string().nullish(),
  })).default([]),
  prediction: z.string().nullish(),
});

export function readerPrompt(persona: ReaderPersona, passage: string): CompileMessage[] {
  return [{ role: "system", content: system(persona) }, { role: "user", content: `=== PASSAGE ===\n${passage.trim()}` }];
}

export interface Prediction {
  readonly reader: string;
  readonly round: number;
  readonly text: string;
}

export interface ReaderEditorOptions {
  /** Chat models to rotate through, one per round. */
  readonly models: ReadonlyArray<{ readonly name: string; readonly complete: Complete }>;
  readonly personas?: ReadonlyArray<ReaderPersona>;
  /** Readers per round. Default 1: one persona each round, rotating. */
  readonly perRound?: number;
  /** Called with each reader's prediction of what happens next; predictions are logged, not findings. */
  readonly onPrediction?: (prediction: Prediction) => void;
}

/** Which personas and model read in a round: rotating from round to round. */
export function rotation<T, M>(personas: ReadonlyArray<T>, models: ReadonlyArray<M>, round: number, perRound = 1): Array<{ persona: T; model: M }> {
  const count = Math.min(perRound, personas.length);
  return Array.from({ length: count }, (_, index) => ({
    persona: personas[(round * count + index) % personas.length]!,
    model: models[(round + index) % models.length]!,
  }));
}

const AXES = new Set(["description", "dialogue", "action", "interiority", "backstory", "explanation"]);

/** Turn one reader's reply into judged notes over the passage at `base` in the chapter. */
export function readerFindings(reply: string, persona: ReaderPersona, chapter: number, text: string, passage: Span): { diagnostics: Diagnostic[]; prediction?: string } {
  const json = extractJson(reply);
  if (json === null) throw new Error("no JSON object in the reply");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    value = JSON.parse(escapeStrayQuotes(json));
  }
  const parsed = ReplySchema.parse(value);
  const slice = text.slice(passage.start, passage.end);
  const diagnostics: Diagnostic[] = [];
  for (const reaction of parsed.reactions) {
    if (reaction.kind === "moved") continue;
    const span = locateQuote(slice, reaction.quote);
    if (!span) continue;
    const axis = reaction.axis?.toLowerCase().trim();
    const code = (reaction.kind === "wants-more" || reaction.kind === "wants-less") && axis && AXES.has(axis)
      ? `${reaction.kind === "wants-more" ? "more" : "less"}:${axis}` : reaction.kind;
    const start = passage.start + span.start, end = passage.start + span.end;
    diagnostics.push({
      ruleId: BETA_READER_RULE_ID,
      layer: "judgment",
      severity: "note",
      confidence: "judged",
      code,
      summary: `${persona.name}: ${reaction.note.trim() || reaction.kind}`,
      evidence: [`"${text.slice(start, end)}"`, `reader: ${persona.name}`],
      chapter,
      range: { sourceId: `chapter:${chapter}`, start, end },
      sourceRefs: [{ sourceId: `chapter:${chapter}`, quote: text.slice(start, end) }],
    });
  }
  return { diagnostics, ...(parsed.prediction ? { prediction: parsed.prediction.trim() } : {}) };
}

/**
 * The beta-reader editor. Each round it reads only the changed scenes (the whole
 * chapter in the first round), with the personas and model `rotation` picks.
 * A reader whose reply is unusable is skipped for the round.
 */
export function readerEditor(options: ReaderEditorOptions): Editor {
  const personas = options.personas?.length ? options.personas : DEFAULT_READERS;
  if (options.models.length === 0) throw new Error("the beta-reader panel needs at least one model");
  return {
    role: "beta",
    name: "beta",
    incremental: true,
    async check({ draft, round, scope }: EditorInput) {
      const passages: Span[] = scope?.length ? [...scope] : [{ start: 0, end: draft.text.length }];
      const found: Diagnostic[] = [];
      for (const { persona, model } of rotation(personas, options.models, round, options.perRound)) {
        for (const passage of passages) {
          try {
            const reply = await model.complete(readerPrompt(persona, draft.text.slice(passage.start, passage.end)));
            const result = readerFindings(reply, persona, draft.chapter, draft.text, passage);
            found.push(...result.diagnostics.map((diagnostic) => ({ ...diagnostic, evidence: [...diagnostic.evidence, `model: ${model.name}`] })));
            if (result.prediction) options.onPrediction?.({ reader: persona.name, round, text: result.prediction });
          } catch {
            // One reader's unusable reply costs its notes for this round, not the loop.
          }
        }
      }
      return found;
    },
  };
}
