import type { CurrentStateFact, HookRecord, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { ChapterTexts } from "../../evidence.js";
import { establishedAt } from "../../evidence.js";
import type { Rule, RuleContext } from "../../types.js";
import { renderFact } from "../facts.js";

// Helpers shared by the structural (L4) rules over InkOS story state: the hook
// ledger, chapter summaries and temporal facts. They read no scene annotations.

/** The last chapter the book has: applied state, chapter text, summaries or facts. */
export function bookEnd(snapshot: RuntimeStateSnapshot, chapters?: ChapterTexts): number {
  return Math.max(
    snapshot.manifest.lastAppliedChapter,
    ...(chapters ? [...chapters.keys()] : []),
    ...snapshot.chapterSummaries.rows.map((row) => row.chapter),
    ...snapshot.currentState.facts.map((fact) => fact.sourceChapter),
  );
}

/**
 * Whether the book is finished: `finished` in the rule's options when set, else
 * book.json's status "completed" or a target chapter count the book has reached.
 * A book with no plan is treated as unfinished, so only overdue promises are flagged.
 */
export function isFinished({ options, book }: Pick<RuleContext, "options" | "book">, end: number): boolean {
  if (typeof options.finished === "boolean") return options.finished;
  const plan = book?.plan;
  if (plan?.status === "completed") return true;
  return plan?.targetChapters !== undefined && end >= plan.targetChapters;
}

/** A positive number option, or the fallback when it is absent or not a number. */
export function numberOption(options: RuleContext["options"], key: string, fallback: number): number {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const UNRESOLVED: ReadonlySet<HookRecord["status"]> = new Set(["open", "progressing", "deferred"]);

/**
 * The chapter a hook is first on the page. Hooks the architect seeds from the
 * outline start in chapter 0; until a chapter advances one, the reader has not
 * seen it, so it is no setup yet (null).
 */
export function hookStart(hook: HookRecord): number | null {
  if (hook.startChapter > 0) return hook.startChapter;
  return hook.lastAdvancedChapter > 0 ? hook.lastAdvancedChapter : null;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Hook ids that are specific enough to look for in summary text: not a bare
 * "hook" and at least three characters ("H03", "sister_feud", "伏笔12").
 */
const traceableId = (id: string) => id.length >= 3 && !/^hooks?$/iu.test(id);

function mentions(text: string, id: string): boolean {
  if (!traceableId(id)) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(id)}(?![\\p{L}\\p{N}_-])`, "iu").test(text);
}

/** Chapters whose summary's hook activity names the hook by id. */
export function summaryMentions(snapshot: RuntimeStateSnapshot, hook: HookRecord): number[] {
  return snapshot.chapterSummaries.rows.filter((row) => mentions(row.hookActivity, hook.hookId)).map((row) => row.chapter);
}

/** True when the book's summaries name hooks by id at all, so a hook's absence from them means something. */
export function summariesTraceHooks(snapshot: RuntimeStateSnapshot): boolean {
  return snapshot.hooks.hooks.some((hook) => summaryMentions(snapshot, hook).length > 0);
}

/** Every chapter in which the hook is known to be active: planted, advanced or named in a summary. */
export function hookChapters(snapshot: RuntimeStateSnapshot, hook: HookRecord): number[] {
  const start = hookStart(hook);
  const chapters = new Set([...(start === null ? [] : [start]), ...(hook.lastAdvancedChapter > 0 ? [hook.lastAdvancedChapter] : []), ...summaryMentions(snapshot, hook)]);
  return [...chapters].sort((a, b) => a - b);
}

/** The last chapter the hook was touched in. */
export const lastTouched = (snapshot: RuntimeStateSnapshot, hook: HookRecord) => Math.max(0, ...hookChapters(snapshot, hook));

/**
 * The chapter a hook is due by, from its own `paysOffInArc` when that names a
 * chapter ("ch12", "chapter 12", "第12章", "12"), or null.
 */
export function payoffChapter(hook: HookRecord): number | null {
  const arc = hook.paysOffInArc?.trim();
  if (!arc) return null;
  const match = /^(?:ch(?:apter)?\.?\s*)?(\d+)$/iu.exec(arc) ?? /第\s*(\d+)\s*章/u.exec(arc) ?? /\bch(?:apter)?\.?\s*(\d+)\b/iu.exec(arc);
  return match ? Number(match[1]) : null;
}

/** What the hook promises, for a finding's summary: its expected payoff, else its notes, else its id. */
export function hookPromise(hook: HookRecord): string {
  const text = (hook.expectedPayoff.trim() || hook.notes.trim() || hook.hookId).replace(/\s+/gu, " ");
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

/** One evidence line for a hook as the ledger records it. */
export function renderHook(hook: HookRecord): string {
  const start = hookStart(hook);
  return [
    `hook ${hook.hookId} (${hook.type}, ${hook.status})`,
    start === null ? "planned in the outline" : `opened ch${start}`,
    `last advanced ch${hook.lastAdvancedChapter}`,
    ...(hook.expectedPayoff.trim() ? [`expected payoff: ${hook.expectedPayoff.trim()}`] : []),
    ...(hook.paysOffInArc?.trim() ? [`pays off in: ${hook.paysOffInArc.trim()}`] : []),
  ].join("; ");
}

export interface StructureFindingInput {
  readonly chapter?: number;
  readonly summary: string;
  readonly severity: "warning" | "note";
  /** Evidence lines; facts are added after them. */
  readonly evidence?: ReadonlyArray<string>;
  /** Facts the finding rests on, each with a label. */
  readonly facts?: ReadonlyArray<readonly [label: string, fact: CurrentStateFact]>;
  /** Chapter text, to point the finding at the first cited fact's evidence passage in its chapter. */
  readonly chapters?: ChapterTexts;
}

/** A structural finding at book or chapter level, ranged over a cited fact's passage when the chapter text has it. */
export function structureFinding(rule: Pick<Rule, "id" | "layer">, input: StructureFindingInput): Diagnostic {
  const facts = input.facts ?? [];
  let range: Diagnostic["range"];
  if (input.chapters && input.chapter !== undefined) {
    for (const [, fact] of facts) {
      const located = fact.sourceChapter === input.chapter ? establishedAt(fact, input.chapters).location : undefined;
      if (located) {
        range = { sourceId: `chapter:${located.chapter}`, start: located.start, end: located.end };
        break;
      }
    }
  }
  return {
    code: rule.id.split("/").pop() ?? rule.id,
    ruleId: rule.id,
    layer: rule.layer,
    severity: input.severity,
    confidence: "extracted",
    category: "quality",
    assessment: "issue",
    ...(input.chapter !== undefined ? { chapter: input.chapter } : {}),
    summary: input.summary,
    evidence: [...(input.evidence ?? []), ...facts.map(([label, fact]) => `${label}: ${renderFact(fact)}`)],
    ...(facts.length ? { facts: facts.map(([, fact]) => ({ ...fact })) } : {}),
    ...(range ? { range } : {}),
  };
}

/** "ch3", "ch3–5". */
export const chapterSpan = (from: number, to: number) => (from === to ? `ch${from}` : `ch${from}–${to}`);
