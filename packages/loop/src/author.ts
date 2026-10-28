import { z } from "zod";
import { escapeStrayQuotes, extractJson, type CompileMessage } from "@plotlint/rules";
import type { Author, AuthorInput, AuthorResponse, Complete } from "./types.js";

// The author agent: an LLM that answers each finding with fix, defend or defer. A fix
// is a list of exact find-and-replace edits inside the region the loop allows for
// that finding, like tracked changes; the agent never returns a whole chapter. The
// loop checks every edit before applying it, so a bad reply costs a round, not the text.

const SYSTEM = `You are the author of a novel, revising one chapter after your editors' notes. The notes come from automated checks and from editors; some are right, some are wrong for this book.

For each note, choose one:
- "fix": change the text. Give one or more edits; each "find" is copied exactly, character for character, from the chapter, and "replace" is what goes in its place. Keep "find" short (a phrase or a sentence) but long enough to occur only once. Change only what the note needs, inside the region given for that note.
- "defend": keep the text as it is. Give a concrete reason tied to what the passage is doing (for example "the repetition is deliberate: it echoes the opening line"). A well-reasoned defence is as good an answer as a fix. Do not fix what is not broken.
- "defer": the note is fair but belongs to a later draft (for example it needs another chapter changed). Give the reason.

Rules:
- Keep the author's voice: match the voice sample's word choice, sentence length and rhythm. Do not reach for rarer synonyms, do not vary sentence lengths by rote, do not add lines that only mention something to make it look set up.
- Never invent plot facts that contradict the chapter.
- Answer every note exactly once.

Reply with one JSON object and nothing else:
{ "responses": [ { "id": "f1", "action": "fix" | "defend" | "defer", "reason": "<one sentence>", "edits": [ { "find": "<exact text>", "replace": "<new text>" } ] } ] }
"edits" is empty for defend and defer.`;

const EditSchema = z.object({ find: z.string(), replace: z.string() });
const ResponseSchema = z.object({
  id: z.string(),
  action: z.enum(["fix", "defend", "defer"]),
  reason: z.string().default(""),
  edits: z.array(EditSchema).nullish().transform((edits) => edits ?? []),
});
const ReplySchema = z.object({ responses: z.array(ResponseSchema) });

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The messages that ask the author agent to answer this round's findings. */
export function authorPrompt(input: AuthorInput): CompileMessage[] {
  const { draft, findings } = input;
  const notes = findings.map((finding) => {
    const d = finding.diagnostic;
    const lines = [`[${finding.id}] ${d.severity} ${d.ruleId}: ${d.summary}`];
    for (const line of d.evidence.slice(0, 4)) lines.push(`  evidence: ${clip(line, 300)}`);
    if (finding.span && finding.span.end > finding.span.start) lines.push(`  flagged text: "${clip(draft.text.slice(finding.span.start, finding.span.end), 400)}"`);
    if (finding.region) {
      const whole = finding.region.start === 0 && finding.region.end === draft.text.length;
      lines.push(whole ? "  you may edit anywhere in the chapter" : `  you may edit only inside: "${clip(draft.text.slice(finding.region.start, finding.region.end), 1200)}"`);
    } else {
      lines.push("  no text region is open for this note: defend or defer it");
    }
    return lines.join("\n");
  });
  const user = [
    "=== VOICE SAMPLE ===",
    clip(input.voiceSample.trim(), 3000),
    "",
    `=== CHAPTER ${draft.chapter} ===`,
    draft.text.trim(),
    "",
    `=== NOTES (round ${input.round}) ===`,
    notes.join("\n\n"),
  ].join("\n");
  return [{ role: "system", content: SYSTEM }, { role: "user", content: user }];
}

/** Parse the author agent's reply; responses to unknown ids are dropped, and a note it skipped gets none. */
export function parseAuthorReply(reply: string, ids: ReadonlyArray<string>): AuthorResponse[] {
  const json = extractJson(reply);
  if (json === null) throw new Error("no JSON object in the reply");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    // Models often leave a quotation mark from the prose unescaped inside a string.
    value = JSON.parse(escapeStrayQuotes(json));
  }
  const parsed = ReplySchema.parse(value);
  const known = new Set(ids);
  const seen = new Set<string>();
  const responses: AuthorResponse[] = [];
  for (const response of parsed.responses) {
    if (!known.has(response.id) || seen.has(response.id)) continue;
    seen.add(response.id);
    responses.push({ id: response.id, action: response.action, reason: response.reason.trim(), edits: response.action === "fix" ? response.edits : [] });
  }
  return responses;
}

export interface LlmAuthorOptions {
  /** For logs, e.g. `llm@glm-4.5-flash`. */
  readonly name: string;
  /** Model calls per round, counting retries after an unusable reply. Default 2. */
  readonly attempts?: number;
  /** Most findings shown in one round, highest ranked first. Default 25. */
  readonly maxFindings?: number;
}

/** An author agent backed by one chat model. */
export function llmAuthor(complete: Complete, options: LlmAuthorOptions): Author {
  const attempts = options.attempts ?? 2;
  const max = options.maxFindings ?? 25;
  return {
    name: options.name,
    async respond(input) {
      const shown = { ...input, findings: input.findings.slice(0, max) };
      const messages = authorPrompt(shown);
      let last: unknown;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const reply = await complete(messages);
        try {
          return parseAuthorReply(reply, shown.findings.map((finding) => finding.id));
        } catch (error) {
          last = error;
        }
      }
      throw new Error(`the author agent's reply was not usable after ${attempts} attempts: ${String(last)}`);
    },
  };
}
