import { z } from "zod";
import { locateQuote, type HookRecord, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { ChapterTexts } from "./evidence.js";
import { AnnotatorSchema, sceneHash } from "./scene-annotations.js";

// The hook overlay, `story/plotlint/hooks.json`: what plotlint knows about the
// settler's hook ledger that the ledger does not record. InkOS's settler opens a
// hook for every small question and seldom closes one, even when a later chapter
// answers it; `inkos lint hooks reconcile` asks the LLM, hook by hook, whether a
// later chapter answers it, and keeps an answer only with a passage of that
// chapter to show for it. The structure rules read the ledger through the
// overlay (`applyHookOverlay`), so InkOS's own state is never rewritten. The
// author may set any entry by hand with annotator "author"; re-running never
// overwrites those. Browser-safe.

export const HookOverlayEntrySchema = z.object({
  /** The hook's `hookId` in the ledger. */
  id: z.string().min(1),
  /** "resolved": a later chapter answers or pays it off; "open": checked, and nothing does (the ledger stands). */
  status: z.enum(["resolved", "open"]),
  /** The chapter that answers it. */
  resolvedIn: z.number().int().min(1).optional(),
  /** The passage of `resolvedIn` that answers it, as the author wrote it. */
  evidence: z.string().min(1).optional(),
  /** What the model said answers it, or why it did not count. */
  note: z.string().min(1).optional(),
  annotator: AnnotatorSchema,
  /** `hookHash` of the hook and the chapters it was checked against, so re-runs skip unchanged hooks. */
  hookHash: z.string().min(1).optional(),
}).strict()
  .refine((entry) => entry.status === "open" || entry.resolvedIn !== undefined, { message: "a resolved entry needs resolvedIn" })
  .refine((entry) => entry.annotator === "author" || entry.status === "open" || entry.evidence !== undefined, { message: "a model's resolved entry needs evidence" });
export type HookOverlayEntry = z.infer<typeof HookOverlayEntrySchema>;

/** `hooks.json` in the book's plotlint folder. */
export const HookOverlayFileSchema = z.object({
  version: z.literal(1),
  hooks: z.array(HookOverlayEntrySchema).default([]),
}).strict();
export type HookOverlayFile = z.infer<typeof HookOverlayFileSchema>;

/** The chapter after which a hook's answer is looked for: its last advance, or where it opened. */
export const hookCheckedFrom = (hook: HookRecord) => Math.max(hook.startChapter, hook.lastAdvancedChapter);

/**
 * A hash of what a reconcile run judged: the hook's record and the text of every
 * chapter after its last advance. A changed hook or a revised later chapter gets
 * checked again.
 */
export function hookHash(hook: HookRecord, chapters: ChapterTexts): string {
  const from = hookCheckedFrom(hook);
  const record = [hook.hookId, hook.type, hook.status, hook.startChapter, hook.lastAdvancedChapter, hook.expectedPayoff, hook.notes, hook.paysOffInArc ?? ""].join("\u0000");
  const later = [...chapters].filter(([chapter]) => chapter > from).sort(([a], [b]) => a - b)
    .map(([chapter, text]) => `${chapter}:${sceneHash(text)}`);
  return sceneHash([record, ...later].join("\n"));
}

/** Merge fresh entries into the overlay: the author's entries always win; the rest replace by id. */
export function mergeHookOverlay(existing: ReadonlyArray<HookOverlayEntry>, fresh: ReadonlyArray<HookOverlayEntry>): HookOverlayEntry[] {
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  for (const entry of fresh) {
    if (byId.get(entry.id)?.annotator === "author") continue;
    byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

/**
 * The chapter an overlay entry resolves its hook in, or null when it does not
 * count: it is not "resolved", the ledger already closed the hook, the chapter
 * comes before the hook's last advance, or (for a model's entry, when the chapter
 * text is at hand) its evidence is no longer in that chapter. The author's
 * entries need no evidence.
 */
export function overlayResolution(hook: HookRecord, entry: HookOverlayEntry | undefined, chapters?: ChapterTexts): number | null {
  if (!entry || entry.status !== "resolved" || entry.resolvedIn === undefined) return null;
  if (hook.status === "resolved" || hook.status === "superseded") return null;
  if (entry.resolvedIn < hook.lastAdvancedChapter) return null;
  if (entry.annotator !== "author") {
    if (!entry.evidence) return null;
    const text = chapters?.get(entry.resolvedIn);
    if (chapters && (text === undefined || !locateQuote(text.replace(/\r\n?/gu, "\n"), entry.evidence))) return null;
  }
  return entry.resolvedIn;
}

/**
 * The snapshot with the overlay applied: each hook the overlay resolves becomes
 * "resolved" in its chapter (as `lastAdvancedChapter`, which is where the ledger
 * keeps a resolved hook's chapter). The snapshot itself is not changed.
 */
export function applyHookOverlay(snapshot: RuntimeStateSnapshot, overlay: HookOverlayFile | undefined, chapters?: ChapterTexts): RuntimeStateSnapshot {
  if (!overlay?.hooks.length) return snapshot;
  const byId = new Map(overlay.hooks.map((entry) => [entry.id, entry]));
  let changed = false;
  const hooks = snapshot.hooks.hooks.map((hook) => {
    const chapter = overlayResolution(hook, byId.get(hook.hookId), chapters);
    if (chapter === null) return hook;
    changed = true;
    return { ...hook, status: "resolved" as const, lastAdvancedChapter: chapter };
  });
  return changed ? { ...snapshot, hooks: { ...snapshot.hooks, hooks } } : snapshot;
}

/** One row of `inkos lint hooks`: a hook as the ledger has it and as the overlay reads it. */
export interface HookStatusRow {
  readonly id: string;
  readonly promise: string;
  readonly opened: number;
  readonly lastAdvanced: number;
  readonly state: HookRecord["status"];
  /** The status the structure rules see. */
  readonly effective: HookRecord["status"];
  readonly entry?: HookOverlayEntry;
  /** The overlay resolves it and its evidence holds. */
  readonly resolvedIn?: number;
  /** A model's entry made against a different hook record or chapter text. */
  readonly stale: boolean;
}

/** Every hook in the ledger with its overlay entry, for listing. */
export function hookStatusRows(snapshot: RuntimeStateSnapshot, overlay: HookOverlayFile | undefined, chapters: ChapterTexts): HookStatusRow[] {
  const byId = new Map((overlay?.hooks ?? []).map((entry) => [entry.id, entry]));
  return snapshot.hooks.hooks.map((hook) => {
    const entry = byId.get(hook.hookId);
    const resolvedIn = overlayResolution(hook, entry, chapters);
    return {
      id: hook.hookId,
      promise: (hook.expectedPayoff.trim() || hook.notes.trim() || hook.hookId).replace(/\s+/gu, " "),
      opened: hook.startChapter,
      lastAdvanced: hook.lastAdvancedChapter,
      state: hook.status,
      effective: resolvedIn === null ? hook.status : "resolved",
      ...(entry ? { entry } : {}),
      ...(resolvedIn === null ? {} : { resolvedIn }),
      stale: !!entry && entry.annotator !== "author" && !!entry.hookHash && entry.hookHash !== hookHash(hook, chapters),
    };
  });
}
