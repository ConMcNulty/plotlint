import { z } from "zod";
import { locateQuote, type HookRecord, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { ChapterTexts } from "./evidence.js";
import { hookCheckedFrom, hookHash, type HookOverlayEntry } from "./hook-overlay.js";
import { extractJson, type CompileMessage, type CompleteFn } from "./invariant-compile.js";
import { detectLanguage, escapeStrayQuotes, type AnnotateLanguage } from "./scene-annotate.js";

// Reconciling the settler's hook ledger with the prose: for a hook the ledger
// leaves open, the LLM reads the chapters after its last advance and says whether
// one of them answers the question or pays the promise off. The model only
// proposes: an answer counts only with a passage it quotes from that chapter,
// found there with `locateQuote`; without one the hook stays open. The LLM call
// is injected, so this module needs no client and the tests use a fake.

/** Ledger statuses a reconcile run looks at. */
export const RECONCILED_STATUSES: ReadonlySet<HookRecord["status"]> = new Set(["open", "progressing", "deferred"]);

export interface ReconcileOptions {
  /** `llm@<model>`, stored on each entry. */
  readonly annotator: string;
  /** Prompt language; detected from the chapters when absent. */
  readonly language?: AnnotateLanguage;
  /** Model calls per hook, counting the retry after a bad reply or a quote not in the text. Default 2. */
  readonly attempts?: number;
  /** Called before each model call, so a caller can show progress. */
  readonly onCall?: (hook: HookRecord, attempt: number) => void;
}

const SYSTEM_EN = `You check a novel's plot ledger against its text for a developmental editor. The ledger lists questions the story raised and promises it made ("hooks"). Some are still marked open although a later chapter answers them. You get one hook and the chapters written after it was last advanced, each opened by a line "=== CHAPTER <n> ===".

Decide whether one of these chapters answers the hook's question or pays off its promise ON THE PAGE: the text states the answer, shows the thing happen, or settles it for good (it succeeds, fails or is explicitly given up). A hint, a suspicion, a plan to deal with it later or a bare mention is NOT an answer. If the chapters never come back to it, it is not answered.

Reply with one JSON object and nothing else:
{ "answered": true | false, "chapter": <the chapter number that answers it, or null>, "quote": "<the sentence that answers it, or null>", "how": "<one short sentence: what the answer is, or why there is none>" }

Rules:
- The quote is copied exactly from that chapter's text: one sentence or clause of 5 to 30 words, character for character, never paraphrased, shortened or joined from two places.
- Give the first chapter that answers it.
- When unsure, answer false.`;

const SYSTEM_ZH = `你为发展编辑核对小说的伏笔账本与正文。账本列出故事提出的问题和许下的承诺（伏笔），有些在后文已经解答却仍标为未回收。你会得到一个伏笔和它最后推进之后的各章，每章以一行 "=== CHAPTER <n> ===" 开头。

判断这些章节中是否有一章在正文里解答了这个问题或兑现了这个承诺：正文写明答案、写出这件事发生，或彻底了结（成功、失败或明确放弃）。暗示、怀疑、打算以后处理或仅仅提及都不算。后文没有再写到就是没有解答。

只回复一个 JSON 对象，不要其他文字，键名保持英文：
{ "answered": true | false, "chapter": <解答它的章号，或 null>, "quote": "<解答它的那句原文，或 null>", "how": "<一句话：答案是什么，或为什么没有>" }

规则：
- 引文必须逐字照抄该章原文中的一句话（10 到 50 个字），不改写、不缩写、不拼接。
- 给出最早解答它的一章。
- 拿不准时回答 false。`;

/** The chapters after the hook's last advance, each opened by its `=== CHAPTER <n> ===` line. */
export function laterChapters(hook: HookRecord, chapters: ChapterTexts): Array<[number, string]> {
  const from = hookCheckedFrom(hook);
  return [...chapters].filter(([chapter]) => chapter > from).sort(([a], [b]) => a - b)
    .map(([chapter, text]) => [chapter, text.replace(/\r\n?/gu, "\n")]);
}

/** The messages that ask a model whether a later chapter answers one hook. */
export function reconcilePrompt(hook: HookRecord, chapters: ChapterTexts, options: Pick<ReconcileOptions, "language"> = {}): CompileMessage[] {
  const later = laterChapters(hook, chapters);
  const zh = (options.language ?? detectLanguage(later.map(([, text]) => text).join("\n").slice(0, 4000))) === "zh";
  const body = later.map(([chapter, text]) => `=== CHAPTER ${chapter} ===\n${text.trim()}`).join("\n\n");
  const lines = [
    // The chapters come first so calls about hooks with the same last advance share a prefix.
    body,
    "",
    zh ? "=== 伏笔 ===" : "=== HOOK ===",
    `id: ${hook.hookId}`,
    `${zh ? "类型" : "type"}: ${hook.type}`,
    ...(hook.expectedPayoff.trim() ? [`${zh ? "预期回收" : "expected payoff"}: ${hook.expectedPayoff.trim()}`] : []),
    ...(hook.notes.trim() ? [`${zh ? "备注" : "notes"}: ${hook.notes.trim()}`] : []),
    zh ? `第 ${hook.startChapter} 章提出，最后推进于第 ${hook.lastAdvancedChapter} 章。` : `Opened in chapter ${hook.startChapter}, last advanced in chapter ${hook.lastAdvancedChapter}.`,
    zh ? `以上各章（${later.map(([n]) => n).join(", ")}）是否解答了它？` : `Do the chapters above (${later.map(([n]) => n).join(", ")}) answer it?`,
  ];
  return [{ role: "system", content: zh ? SYSTEM_ZH : SYSTEM_EN }, { role: "user", content: lines.join("\n") }];
}

const ReplySchema = z.object({
  answered: z.boolean(),
  chapter: z.number().int().min(1).nullable(),
  quote: z.string().nullable(),
  how: z.string().nullable(),
});
export type ReconcileReply = z.infer<typeof ReplySchema>;

export type ReconcileParseResult =
  | { readonly ok: true; readonly reply: ReconcileReply }
  | { readonly ok: false; readonly error: string };

const EMPTY = /^(?:null|none|n\/?a|-|—|无|没有)?$/iu;
const nullable = (value: unknown) => (typeof value === "string" && EMPTY.test(value.trim()) ? null : value ?? null);

/**
 * Parse a model's reply. Small slips are repaired: "true" for true, "ch12" or
 * "12" for 12, "null" for null. An answer without a chapter or a quote is an error,
 * so the model is asked again.
 */
export function parseReconcileReply(reply: string): ReconcileParseResult {
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/giu, "");
  let parsed: unknown;
  try {
    const json = extractJson(cleaned);
    if (json === null) return { ok: false, error: "the reply has no JSON object" };
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      const repaired = extractJson(escapeStrayQuotes(cleaned.slice(cleaned.indexOf("{"))));
      if (repaired === null) throw error;
      parsed = JSON.parse(repaired);
    }
  } catch (error) {
    return { ok: false, error: `the JSON does not parse: ${(error as Error).message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "the reply is not a JSON object" };
  const record = parsed as Record<string, unknown>;
  const answered = typeof record.answered === "string" ? /^(?:true|yes|是)$/iu.test(record.answered.trim()) : record.answered;
  const rawChapter = nullable(record.chapter);
  const chapter = typeof rawChapter === "string" && /\d+/u.test(rawChapter) ? Number(/\d+/u.exec(rawChapter)![0]) : rawChapter;
  const quote = nullable(record.quote ?? record.evidence);
  const result = ReplySchema.safeParse({ answered, chapter, quote, how: nullable(record.how ?? record.explanation ?? record.reason) });
  if (!result.success) {
    return { ok: false, error: `the reply is not valid: ${result.error.issues.map((issue) => `${issue.path.join(".") || "reply"}: ${issue.message}`).join("; ")}` };
  }
  if (result.data.answered && (result.data.chapter === null || !result.data.quote)) {
    return { ok: false, error: "\"answered\" is true but the chapter or the quote is missing" };
  }
  return { ok: true, reply: result.data };
}

export interface HookReconciliation {
  readonly entry: HookOverlayEntry;
  /** Model calls made. */
  readonly calls: number;
  /** The model said it is answered, but its quote was not in the chapter it named (so the hook stays open, and is asked about again next run). */
  readonly dropped: boolean;
}

/**
 * Ask whether a chapter after a hook's last advance answers it. A reply that does
 * not parse, or names a passage that is not in its chapter, is sent back once
 * with the problem. Throws when no reply parses.
 */
export async function reconcileHook(
  hook: HookRecord,
  chapters: ChapterTexts,
  complete: CompleteFn,
  options: ReconcileOptions,
): Promise<HookReconciliation> {
  const hash = hookHash(hook, chapters);
  const later = new Map(laterChapters(hook, chapters));
  const open = (calls: number, note: string | null, dropped = false): HookReconciliation => ({
    // A dropped answer keeps no hash, so the next run asks again.
    entry: { id: hook.hookId, status: "open", ...(note ? { note } : {}), annotator: options.annotator, ...(dropped ? {} : { hookHash: hash }) },
    calls,
    dropped,
  });
  if (later.size === 0) return open(0, null);

  const messages = reconcilePrompt(hook, chapters, options);
  const attempts = options.attempts ?? 2;
  let lastError = "";
  let unlocated: ReconcileReply | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    options.onCall?.(hook, attempt);
    const reply = await complete(messages);
    const result = parseReconcileReply(reply);
    if (!result.ok) {
      lastError = result.error;
      messages.push(
        { role: "assistant", content: reply },
        { role: "user", content: `That reply could not be used: ${result.error}. Reply again with only the JSON object.` },
      );
      continue;
    }
    const { answered, chapter, quote, how } = result.reply;
    if (!answered) return open(attempt, how);
    const text = later.get(chapter!);
    const span = text === undefined ? null : locateQuote(text, quote!);
    if (span) {
      return {
        entry: {
          id: hook.hookId, status: "resolved", resolvedIn: chapter!, evidence: text!.slice(span.start, span.end),
          ...(how ? { note: how } : {}), annotator: options.annotator, hookHash: hash,
        },
        calls: attempt,
        dropped: false,
      };
    }
    unlocated = result.reply;
    lastError = text === undefined ? `chapter ${chapter} is not one of the chapters given` : `the quote is not in chapter ${chapter}`;
    messages.push(
      { role: "assistant", content: reply },
      {
        role: "user",
        content: text === undefined
          ? `Chapter ${chapter} is not one of the chapters given (${[...later.keys()].join(", ")}). Reply again with only the JSON object.`
          : `That quote is not in chapter ${chapter} word for word. Find the chapter whose text answers the hook (it may be another one) and copy one sentence from it exactly, or answer false if none does. Reply with only the JSON object.`,
      },
    );
  }
  if (unlocated) return open(attempts, `answer dropped: ${lastError} (said: ${unlocated.how ?? "answered"})`, true);
  throw new Error(`Could not reconcile hook ${hook.hookId} after ${attempts} attempts: ${lastError}`);
}

/**
 * The hooks a reconcile run should ask about: on the page, left open by the
 * ledger, with chapters after their last advance, and (with `chapter`) opened in
 * that chapter. Hooks seeded from the outline that no chapter advanced are not on
 * the page.
 */
export function hooksToReconcile(snapshot: RuntimeStateSnapshot, chapters: ChapterTexts, chapter?: number): HookRecord[] {
  return snapshot.hooks.hooks.filter((hook) => {
    if (!RECONCILED_STATUSES.has(hook.status)) return false;
    const start = hook.startChapter > 0 ? hook.startChapter : hook.lastAdvancedChapter > 0 ? hook.lastAdvancedChapter : null;
    if (start === null || (chapter !== undefined && start !== chapter)) return false;
    return [...chapters.keys()].some((n) => n > hookCheckedFrom(hook));
  });
}
