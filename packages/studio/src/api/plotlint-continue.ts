// Ghost text (PLAN, "Ghost text (optional, off by default)"): a few words that
// could come next at the cursor, from the project's configured LLM. The editor
// shows them greyed out and Tab accepts them. Only the text before the cursor
// (its last few thousand characters) and the start of the text after it are sent.

/** Characters of context before the cursor that are sent; more are cut from the front. */
export const MAX_BEFORE = 4_000;
/** Characters after the cursor that are sent, so the continuation can lead into them. */
export const MAX_AFTER = 400;
/** The longest continuation shown, in characters. */
export const MAX_CONTINUATION = 160;

export interface ContinueRequest {
  readonly bookId: string;
  readonly before: string;
  readonly after: string;
}

export type ChatMessage = { readonly role: "system" | "user"; readonly content: string };

/** Parse and validate a continuation request body. Over-long context is trimmed, not refused. */
export function parseContinueBody(body: unknown): ContinueRequest | string {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  const { bookId, before, after } = body as Record<string, unknown>;
  if (typeof bookId !== "string" || !bookId) return "bookId must be a non-empty string";
  if (typeof before !== "string") return "before must be a string";
  if (after !== undefined && after !== null && typeof after !== "string") return "after must be a string";
  return { bookId, before: before.slice(-MAX_BEFORE), after: typeof after === "string" ? after.slice(0, MAX_AFTER) : "" };
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function continuationMessages(request: Pick<ContinueRequest, "before" | "after">): ChatMessage[] {
  const after = request.after.trim();
  return [
    {
      role: "system",
      content: [
        "You suggest how a novelist's sentence might go on, like an autocomplete.",
        "Reply with only the next few words (at most one sentence, about 4 to 15 words) that follow the text exactly where it stops.",
        "Match its language, tense, point of view and voice. Never repeat the text, never add quotes around your reply, never explain.",
        after ? "The words you write must lead naturally into the text that follows the cursor." : "",
      ].filter(Boolean).join(" "),
    },
    {
      role: "user",
      content: `Text before the cursor:\n<<<\n${request.before}\n>>>${after ? `\n\nText after the cursor:\n<<<\n${after}\n>>>` : ""}`,
    },
  ];
}

/**
 * The model's reply as text to insert at the cursor: one line, without wrapping
 * quotes or a repeat of the text's last words, cut at a sentence end or a word
 * boundary, with a space in front when the words would otherwise run together.
 * Null when nothing usable is left.
 */
export function cleanContinuation(reply: string, before: string): string | null {
  let text = reply.replace(/^\s*(?:<<<|>>>)\s*/u, "").split(/\r?\n/u).find((line) => line.trim())?.trim() ?? "";
  text = text.replace(/^(["'“”‘’「」『』`*_]+)(.*?)\1$/u, "$2").replace(/^[`*_]+|[`*_]+$/gu, "").trim();
  if (!text) return null;
  // A model that echoes the end of the text: keep only what comes after it.
  const tail = before.slice(-80).trimEnd();
  for (let size = Math.min(tail.length, text.length); size >= 8; size -= 1) {
    if (text.startsWith(tail.slice(-size))) {
      text = text.slice(size).trimStart();
      break;
    }
  }
  if (!text) return null;
  if (text.length > MAX_CONTINUATION) {
    const cut = text.slice(0, MAX_CONTINUATION);
    const sentence = cut.search(/[.!?。！？](?=[^.!?。！？]*$)/u);
    text = sentence > 0 ? cut.slice(0, sentence + 1) : cut.replace(/\s+\S*$/u, "");
  }
  const last = before.slice(-1);
  const needsSpace = last !== "" && !/\s/u.test(last) && !CJK.test(last) && !CJK.test(text[0]!) && !/^[,.;:!?)\]}’”'"…—-]/u.test(text);
  return needsSpace ? ` ${text}` : text;
}

/** A continuation for the request, or null when the model has nothing usable. */
export async function continueText(
  request: Pick<ContinueRequest, "before" | "after">,
  complete: (messages: ChatMessage[]) => Promise<string>,
): Promise<string | null> {
  if (!request.before.trim()) return null;
  return cleanContinuation(await complete(continuationMessages(request)), request.before);
}
