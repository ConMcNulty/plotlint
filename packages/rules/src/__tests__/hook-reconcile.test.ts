import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HookRecord, RuntimeStateSnapshot } from "@actalk/inkos-core";
import {
  applyHookOverlay, checkSnapshot, HookOverlayFileSchema, hookHash, hooksToReconcile, hookStatusRows, mergeHookOverlay,
  openQuestions, parseReconcileReply, reconcileHook, reconcilePrompt, subplotBalance, unpaidSetup,
  type ChapterTexts, type CompileMessage, type HookOverlayEntry, type HookOverlayFile,
} from "../index.js";
import { loadBookRuleData } from "../node.js";

const hook = (hookId: string, startChapter: number, status: HookRecord["status"], lastAdvancedChapter: number, extra: Partial<HookRecord> = {}): HookRecord => ({
  hookId, startChapter, type: "mystery", status, lastAdvancedChapter, expectedPayoff: `the answer to ${hookId}`, notes: "", ...extra,
});

const chapters: ChapterTexts = new Map([
  [1, "# Chapter 1\n\nThe lantern lay in the reeds, and nobody knew who had hidden it there."],
  [2, "# Chapter 2\n\nMira asked about the lantern again. Pell only shrugged."],
  [3, "# Chapter 3\n\n\"I hid the lantern in the reeds myself,\" Pell said at last, \"so the boats would miss the channel.\"\r\nMira said nothing."],
]);

function book(hooks: HookRecord[], last = 3): RuntimeStateSnapshot {
  return {
    manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: last, projectionVersion: 1 },
    currentState: { chapter: last, facts: [] },
    hooks: { hooks },
    chapterSummaries: { rows: [] },
  };
}

/** A fake model that replays canned replies and records what it was sent. */
function fake(...replies: string[]) {
  const calls: CompileMessage[][] = [];
  const complete = async (messages: ReadonlyArray<CompileMessage>) => {
    calls.push([...messages]);
    const next = replies.shift();
    if (next === undefined) throw new Error("no more canned replies");
    return next;
  };
  return { complete, calls };
}

const lantern = hook("lantern", 1, "open", 1, { expectedPayoff: "Who hid the lantern in the reeds" });
const options = { annotator: "llm@test" };

describe("parseReconcileReply", () => {
  it("reads a plain answer and repairs small slips", () => {
    expect(parseReconcileReply('<think>hm</think>```json\n{"answered": "true", "chapter": "ch3", "quote": "I hid the lantern", "how": "Pell confesses"}\n```'))
      .toEqual({ ok: true, reply: { answered: true, chapter: 3, quote: "I hid the lantern", how: "Pell confesses" } });
    expect(parseReconcileReply('{"answered": false, "chapter": "null", "quote": "none", "how": "never returns"}'))
      .toEqual({ ok: true, reply: { answered: false, chapter: null, quote: null, how: "never returns" } });
  });

  it("rejects an answer without a chapter or a quote, and a reply with no JSON", () => {
    expect(parseReconcileReply('{"answered": true, "chapter": 3, "quote": null}')).toMatchObject({ ok: false, error: expect.stringMatching(/quote is missing/u) });
    expect(parseReconcileReply("It is answered in chapter 3.")).toMatchObject({ ok: false });
  });

  it("escapes dialogue quotes the model left unescaped", () => {
    const result = parseReconcileReply('{"answered": true, "chapter": 3, "quote": ""I hid the lantern in the reeds myself," Pell said", "how": "x"}');
    expect(result).toMatchObject({ ok: true, reply: { chapter: 3, quote: "\"I hid the lantern in the reeds myself,\" Pell said" } });
  });
});

describe("reconcilePrompt and hooksToReconcile", () => {
  it("sends only the chapters after the hook's last advance, then the hook", () => {
    const [, user] = reconcilePrompt(hook("lantern", 1, "progressing", 2), chapters);
    expect(user!.content).not.toContain("=== CHAPTER 1 ===");
    expect(user!.content).not.toContain("=== CHAPTER 2 ===");
    expect(user!.content).toContain("=== CHAPTER 3 ===");
    expect(user!.content).toMatch(/=== HOOK ===\nid: lantern/u);
    expect(user!.content).toContain("Opened in chapter 1, last advanced in chapter 2.");
  });

  it("asks about hooks on the page the ledger leaves open, with later chapters", () => {
    const snapshot = book([
      lantern, hook("done", 1, "resolved", 3), hook("outline", 0, "open", 0), hook("finale", 2, "open", 3),
      hook("seeded", 0, "deferred", 2), hook("other", 2, "progressing", 2),
    ]);
    expect(hooksToReconcile(snapshot, chapters).map((h) => h.hookId)).toEqual(["lantern", "seeded", "other"]);
    expect(hooksToReconcile(snapshot, chapters, 2).map((h) => h.hookId)).toEqual(["seeded", "other"]);
  });
});

describe("reconcileHook", () => {
  it("keeps an answer whose quote is in the chapter it names, as the author wrote it", async () => {
    const { complete, calls } = fake(JSON.stringify({ answered: true, chapter: 3, quote: "I hid the lantern in the reeds myself", how: "Pell confesses" }));
    const result = await reconcileHook(lantern, chapters, complete, options);
    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      entry: {
        id: "lantern", status: "resolved", resolvedIn: 3, evidence: "I hid the lantern in the reeds myself", note: "Pell confesses",
        annotator: "llm@test", hookHash: hookHash(lantern, chapters),
      },
      calls: 1,
      dropped: false,
    });
    expect(HookOverlayFileSchema.parse({ version: 1, hooks: [result.entry] }).hooks).toHaveLength(1);
  });

  it("records a hook no chapter answers as open", async () => {
    const { complete } = fake('{"answered": false, "chapter": null, "quote": null, "how": "Pell never explains"}');
    const result = await reconcileHook(lantern, chapters, complete, options);
    expect(result.entry).toEqual({ id: "lantern", status: "open", note: "Pell never explains", annotator: "llm@test", hookHash: hookHash(lantern, chapters) });
  });

  it("asks again when the quote is not in the chapter, and drops an answer it cannot show", async () => {
    const invented = JSON.stringify({ answered: true, chapter: 3, quote: "Pell admitted everything to the harbour master that night", how: "x" });
    const wrongChapter = JSON.stringify({ answered: true, chapter: 1, quote: "The lantern lay in the reeds", how: "x" });
    const { complete, calls } = fake(invented, wrongChapter);
    const result = await reconcileHook(lantern, chapters, complete, options);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.at(-1)!.content).toMatch(/not in chapter 3 word for word. Find the chapter/u);
    // The second reply names ch1, which is not after the hook's last advance.
    expect(result.dropped).toBe(true);
    expect(result.entry.status).toBe("open");
    expect(result.entry.note).toMatch(/^answer dropped/u);
    expect(result.entry.hookHash).toBeUndefined();

    const retry = fake(invented, JSON.stringify({ answered: true, chapter: 3, quote: "so the boats would miss the channel", how: "y" }));
    expect((await reconcileHook(lantern, chapters, retry.complete, options)).entry).toMatchObject({ status: "resolved", resolvedIn: 3 });
  });

  it("retries a reply that does not parse once, then fails", async () => {
    const ok = fake("sure", '{"answered": false, "chapter": null, "quote": null, "how": null}');
    expect((await reconcileHook(lantern, chapters, ok.complete, options)).calls).toBe(2);
    expect(ok.calls[1]!.at(-1)!.content).toMatch(/no JSON object/u);
    await expect(reconcileHook(lantern, chapters, fake("no", "still no").complete, options)).rejects.toThrow(/after 2 attempts/u);
  });

  it("makes no call for a hook with no later chapter", async () => {
    const result = await reconcileHook(hook("finale", 1, "open", 3), chapters, fake().complete, options);
    expect(result).toMatchObject({ calls: 0, entry: { status: "open" } });
  });
});

describe("the hook overlay", () => {
  const resolved = (extra: Partial<HookOverlayEntry> = {}): HookOverlayEntry => ({
    id: "lantern", status: "resolved", resolvedIn: 3, evidence: "I hid the lantern in the reeds myself", annotator: "llm@test", hookHash: "x", ...extra,
  });
  const overlay = (...hooks: HookOverlayEntry[]): HookOverlayFile => ({ version: 1, hooks });

  it("validates entries: a resolved one needs a chapter, a model's needs evidence", () => {
    expect(HookOverlayFileSchema.safeParse(overlay(resolved({ resolvedIn: undefined }))).success).toBe(false);
    expect(HookOverlayFileSchema.safeParse(overlay(resolved({ evidence: undefined }))).success).toBe(false);
    expect(HookOverlayFileSchema.safeParse(overlay(resolved({ evidence: undefined, annotator: "author" }))).success).toBe(true);
    expect(HookOverlayFileSchema.safeParse(overlay(resolved({ annotator: "me" }))).success).toBe(false);
  });

  it("resolves a hook in its chapter when its evidence is still there", () => {
    const snapshot = book([lantern, hook("other", 1, "open", 1)]);
    const applied = applyHookOverlay(snapshot, overlay(resolved()), chapters);
    expect(applied.hooks.hooks[0]).toMatchObject({ hookId: "lantern", status: "resolved", lastAdvancedChapter: 3 });
    expect(applied.hooks.hooks[1]).toBe(snapshot.hooks.hooks[1]);
    expect(snapshot.hooks.hooks[0]!.status).toBe("open");
    // Gone from the chapter: the entry no longer counts. The author's entries need no evidence.
    const revised = new Map(chapters).set(3, "Pell said nothing.");
    expect(applyHookOverlay(snapshot, overlay(resolved()), revised)).toBe(snapshot);
    expect(applyHookOverlay(snapshot, overlay(resolved({ annotator: "author", evidence: undefined })), revised).hooks.hooks[0]!.status).toBe("resolved");
    // "open" entries, hooks the ledger already closed and chapters before the last advance change nothing.
    expect(applyHookOverlay(snapshot, overlay(resolved({ status: "open" })), chapters)).toBe(snapshot);
    expect(applyHookOverlay(book([hook("lantern", 1, "progressing", 3)]), overlay(resolved({ resolvedIn: 2, evidence: "Pell only shrugged" })), chapters).hooks.hooks[0]!.status).toBe("progressing");
  });

  it("lets the author's entries win a merge", () => {
    const author = resolved({ annotator: "author" });
    expect(mergeHookOverlay([author], [resolved({ status: "open", resolvedIn: undefined, evidence: undefined })])).toEqual([author]);
    expect(mergeHookOverlay([resolved()], [resolved({ resolvedIn: 2 })])).toEqual([resolved({ resolvedIn: 2 })]);
  });

  it("hashes the hook and the later chapters, so a revision there makes an entry stale", () => {
    const hash = hookHash(lantern, chapters);
    expect(hookHash(lantern, new Map(chapters).set(1, "rewritten"))).toBe(hash);
    expect(hookHash(lantern, new Map(chapters).set(3, "rewritten"))).not.toBe(hash);
    expect(hookHash({ ...lantern, notes: "more" }, chapters)).not.toBe(hash);
    const rows = hookStatusRows(book([lantern]), overlay(resolved({ hookHash: hash })), chapters);
    expect(rows).toEqual([expect.objectContaining({ id: "lantern", state: "open", effective: "resolved", resolvedIn: 3, stale: false })]);
    expect(hookStatusRows(book([lantern]), overlay(resolved()), chapters)[0]!.stale).toBe(true);
  });

  it("is read by the structure rules through the engine", () => {
    const hooks = [lantern, hook("sister", 1, "open", 1, { expectedPayoff: "Make peace with Bea" })];
    const snapshot = book(hooks, 6);
    const longer = new Map(chapters).set(4, "x").set(5, "y").set(6, "z");
    const run = (file?: HookOverlayFile) => checkSnapshot(snapshot, {
      rules: [unpaidSetup, openQuestions, subplotBalance], chapters: longer, book: { plan: { status: "completed" }, ...(file ? { hooks: file } : {}) },
    }).filter((d) => d.ruleId === "structure/unpaid-setup").map((d) => d.summary);
    expect(run()).toHaveLength(2);
    expect(run(overlay(resolved()))).toEqual([expect.stringMatching(/Make peace with Bea/u)]);
    // Rules that do not ask for it (the cut test asks what a chapter sets up) see the ledger as is.
    const seen: string[] = [];
    const probe = (hookOverlay: boolean) => ({
      id: `structure/probe-${hookOverlay ? "overlay" : "ledger"}`, layer: "structure" as const, rationale: "test", hookOverlay,
      check: ({ snapshot: state }: { snapshot: RuntimeStateSnapshot }) => { seen.push(state.hooks.hooks[0]!.status); return []; },
    });
    checkSnapshot(snapshot, { rules: [probe(true), probe(false)], chapters: longer, book: { hooks: overlay(resolved()) } });
    expect(seen).toEqual(["resolved", "open"]);
  });

  it("is loaded from story/plotlint/hooks.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plotlint-hooks-"));
    try {
      await mkdir(join(dir, "story", "plotlint"), { recursive: true });
      await writeFile(join(dir, "story", "plotlint", "hooks.json"), JSON.stringify(overlay(resolved())), "utf-8");
      expect((await loadBookRuleData(dir)).hooks?.hooks).toEqual([resolved()]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
