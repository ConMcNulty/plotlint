import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChapterSummaryRow, CurrentStateFact, HookRecord, RuntimeStateSnapshot } from "@actalk/inkos-core";
import {
  checkSnapshot, cutCandidate, dependencyGraph, openCounts, openQuestions, RuleConfigFileSchema, subplotBalance, subplots,
  unearnedPayoff, unpaidSetup, type BookRuleData, type Rule,
} from "../index.js";
import { loadBookRuleData, readBookPlan } from "../node.js";
import { fact, kinded } from "./fixtures.js";

const hook = (hookId: string, startChapter: number, status: HookRecord["status"], lastAdvancedChapter: number, extra: Partial<HookRecord> = {}): HookRecord => ({
  hookId, startChapter, type: "mystery", status, lastAdvancedChapter, expectedPayoff: `the answer to ${hookId}`, notes: "", ...extra,
});

const row = (chapter: number, extra: Partial<ChapterSummaryRow> = {}): ChapterSummaryRow => ({
  chapter, title: `Chapter ${chapter}`, characters: "", events: "", stateChanges: "", hookActivity: "", mood: "", chapterType: "", ...extra,
});

function book(last: number, parts: { facts?: CurrentStateFact[]; hooks?: HookRecord[]; rows?: ChapterSummaryRow[] } = {}): RuntimeStateSnapshot {
  return {
    manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: last, projectionVersion: 1 },
    currentState: { chapter: last, facts: parts.facts ?? [] },
    hooks: { hooks: parts.hooks ?? [] },
    chapterSummaries: { rows: parts.rows ?? [] },
  };
}

const finished: BookRuleData = { plan: { targetChapters: 10, status: "completed" } };
const unfinished: BookRuleData = { plan: { targetChapters: 40, status: "active" } };
const run = (rule: Rule, snapshot: RuntimeStateSnapshot, data: BookRuleData = {}, chapters?: Map<number, string>) =>
  checkSnapshot(snapshot, { rules: [rule], book: data, ...(chapters ? { chapters } : {}) });
const withOptions = (data: BookRuleData, id: string, options: Record<string, unknown>): BookRuleData =>
  ({ ...data, config: RuleConfigFileSchema.parse({ version: 1, rules: { [id]: { options } } }) });

describe("structure/unpaid-setup", () => {
  it("flags a hook a finished book never resolves, as a warning when it went quiet early", () => {
    const [finding, ...rest] = run(unpaidSetup, book(10, { hooks: [hook("sister", 2, "open", 4), hook("done", 1, "resolved", 6)] }), finished);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ ruleId: "structure/unpaid-setup", layer: "structure", severity: "warning", confidence: "extracted", chapter: 2 });
    expect(finding!.summary).toBe("\"the answer to sister\", opened in ch2, last advanced in ch4, is never resolved by the last chapter (ch10).");
    expect(finding!.evidence[0]).toMatch(/^hook sister \(mystery, open\); opened ch2; last advanced ch4/u);
  });

  it("leaves open endings (hooks the last chapter advances) alone unless asked", () => {
    const snapshot = book(10, { hooks: [hook("sequel", 3, "open", 10)] });
    expect(run(unpaidSetup, snapshot, finished)).toEqual([]);
    expect(run(unpaidSetup, snapshot, withOptions(finished, "structure/unpaid-setup", { flagOpenEndings: true }))[0]).toMatchObject({ severity: "note" });
  });

  it("in an unfinished book flags only overdue hooks: past staleAfter or past their own payoff chapter", () => {
    const snapshot = book(12, { hooks: [hook("fresh", 8, "open", 9), hook("stale", 1, "progressing", 2), hook("due", 5, "open", 11, { paysOffInArc: "ch10" })] });
    const found = run(unpaidSetup, snapshot, unfinished);
    expect(found.map((d) => d.summary)).toEqual([
      "\"the answer to stale\", opened in ch1, last advanced in ch2, has gone untouched for 10 chapters.",
      "\"the answer to due\", opened in ch5, was due by ch10 and is still open in ch12.",
    ]);
    expect(found.every((d) => d.severity === "warning")).toBe(true);
    expect(run(unpaidSetup, snapshot, withOptions(unfinished, "structure/unpaid-setup", { staleAfter: 20, grace: 3 }))).toEqual([]);
  });

  it("treats a book with no plan as unfinished, and ignores outline hooks no chapter advanced", () => {
    expect(run(unpaidSetup, book(5, { hooks: [hook("open", 2, "open", 3)] }))).toEqual([]);
    expect(run(unpaidSetup, book(10, { hooks: [hook("outline", 0, "deferred", 0)] }), finished)).toEqual([]);
  });

  const ring = [
    kinded("possession", "Mira", "holds", "poisoned ring", 3),
    fact("poisoned ring", "origin", "the Harrow vault", 3),
    fact("Mira", "location", "harbour", 4), fact("Mira", "location", "mill", 5),
  ];
  const text = (chapter: number, body: string) => [chapter, `# Chapter ${chapter}\n\n${body}\n`] as const;

  it("flags an emphasised object that never returns (Chekhov's gun), with its fact and a range over its passage", () => {
    const cited = [{ ...ring[0]!, evidence: { quote: "slipped the poisoned ring onto her finger" } }, ...ring.slice(1)];
    const chapters = new Map([text(3, "Mira slipped the poisoned ring onto her finger."), text(4, "The harbour was cold."), text(5, "The mill was quiet.")]);
    const [finding, ...rest] = run(unpaidSetup, book(5, { facts: cited }), { plan: { status: "completed" } }, chapters);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ severity: "note", chapter: 3, summary: "The poisoned ring, introduced in ch3, never returns." });
    expect(finding!.facts).toHaveLength(1);
    expect(finding!.range).toMatchObject({ sourceId: "chapter:3" });
    expect(chapters.get(3)!.slice(finding!.range!.start, finding!.range!.end)).toBe("slipped the poisoned ring onto her finger");
  });

  it("stays quiet when the object comes back in a later fact or chapter text, or is a plain prop", () => {
    const done = { plan: { status: "completed" } };
    expect(run(unpaidSetup, book(5, { facts: [...ring, fact("Tomas", "drinks from", "the poisoned ring", 5)] }), done)).toEqual([]);
    expect(run(unpaidSetup, book(5, { facts: ring }), done, new Map([text(5, "She turned the ring on her finger.")]))).toEqual([]);
    expect(run(unpaidSetup, book(5, { facts: [ring[0]!, ...ring.slice(2)] }), done)).toEqual([]);
    expect(run(unpaidSetup, book(5, { facts: ring }), withOptions(done, "structure/unpaid-setup", { items: false }))).toEqual([]);
  });

  it("reads an object named before anyone holds it as set up earlier, so holding it is its return", () => {
    // The ostler's lantern in ch2 is the setup; Jonas carrying it in ch4 pays it off.
    const facts = [fact("Ned", "hung", "lantern", 2), kinded("possession", "Jonas", "carries", "lantern", 4), fact("Jonas", "location", "the hill", 5)];
    expect(run(unpaidSetup, book(5, { facts }), { plan: { status: "completed" } })).toEqual([]);
  });
});

describe("structure/unearned-payoff", () => {
  it("notes a hook raised and resolved in the same chapter", () => {
    const [finding] = run(unearnedPayoff, book(6, { hooks: [hook("quick", 4, "resolved", 4), hook("slow", 1, "resolved", 5)] }));
    expect(finding).toMatchObject({ severity: "note", chapter: 4 });
    expect(finding!.summary).toMatch(/raised and resolved in the same chapter \(ch4\)/u);
  });

  it("notes a payoff with no recorded advance between, only when summaries name hooks by id", () => {
    const hooks = [hook("H01", 1, "resolved", 5), hook("H02", 2, "open", 4)];
    const traced = [row(1), row(2, { hookActivity: "H02 opened" }), row(3), row(4, { hookActivity: "H02 advanced" }), row(5, { hookActivity: "H01 resolved" })];
    expect(run(unearnedPayoff, book(5, { hooks, rows: traced })).map((d) => d.chapter)).toEqual([5]);
    const advanced = traced.map((r) => (r.chapter === 3 ? { ...r, hookActivity: "H01 deepens" } : r));
    expect(run(unearnedPayoff, book(5, { hooks, rows: advanced }))).toEqual([]);
    expect(run(unearnedPayoff, book(5, { hooks, rows: traced.map((r) => ({ ...r, hookActivity: "" })) }))).toEqual([]);
    // As GLM summarised the lessing-fen book: other hooks by id, this one only in words.
    const described = traced.map((r) => (r.chapter === 5 ? { ...r, hookActivity: "The missing ledger hook is resolved" } : r));
    expect(run(unearnedPayoff, book(5, { hooks, rows: described }))).toEqual([]);
  });
});

describe("structure/cut-candidate and dependencyGraph", () => {
  const facts = [
    kinded("possession", "Mira", "holds", "brass key", 1),
    fact("Mira", "goal", "find her father", 1),
    fact("Tomas", "location", "the lighthouse", 2),
    fact("Tomas", "plays", "cards with sailors", 2),
    kinded("possession", "Mira", "uses", "brass key", 3),
    fact("Mira", "location", "the vault", 3),
    fact("Mira", "goal", "open the vault", 4),
    fact("Mira", "location", "the cliffs", 5),
  ];

  it("links chapters by what later facts name, and exports the graph", () => {
    const graph = dependencyGraph(book(5, { facts }));
    expect(graph.dependents("ch1").map((e) => [e.to, e.via])).toContainEqual(["ch3", "brass key"]);
    expect(graph.dependents("ch2")).toEqual([]);
    expect(graph.nodes.find((n) => n.id === "ch2")!.introduces).toEqual(["Tomas", "lighthouse", "cards with sailors"]);
  });

  it("flags a chapter nothing later depends on, never the last chapters or a chapter without facts", () => {
    const found = run(cutCandidate, book(6, { facts }));
    expect(found.map((d) => d.chapter)).toEqual([2]);
    expect(found[0]).toMatchObject({ severity: "note", layer: "structure" });
    expect(found[0]!.facts!.length).toBeGreaterThan(0);
    expect(run(cutCandidate, book(6, { facts }), withOptions({}, "structure/cut-candidate", { protectLast: 5 }))).toEqual([]);
  });

  it("counts a later mention in chapter text or a summary as a dependency, and hooks that live on", () => {
    expect(run(cutCandidate, book(6, { facts }), {}, new Map([[4, "Tomas waved from the lighthouse."]]))).toEqual([]);
    expect(run(cutCandidate, book(6, { facts, rows: [row(5, { events: "Tomas returns" })] }))).toEqual([]);
    expect(run(cutCandidate, book(6, { facts, hooks: [hook("cards", 2, "progressing", 4)] }))).toEqual([]);
  });

  it("flags a scene nothing later depends on, when asked and the chapter text has scenes", () => {
    const cited = (f: CurrentStateFact, quote: string): CurrentStateFact => ({ ...f, evidence: { quote } });
    const chapter2 = "# Chapter 2\n\nTomas reached the lighthouse at dusk.\n\n* * *\n\nMira hid the map in the chapel.\n";
    const scened = [
      kinded("possession", "Mira", "holds", "brass key", 1),
      cited(fact("Tomas", "location", "the lighthouse", 2), "Tomas reached the lighthouse"),
      cited(fact("Mira", "hid", "the map", 2), "Mira hid the map"),
      fact("Mira", "reads", "the map", 3), fact("Mira", "found", "the cellar", 3),
      fact("Mira", "location", "the cellar", 4), fact("Mira", "uses", "brass key", 4), fact("Mira", "location", "cliffs", 5),
    ];
    const found = run(cutCandidate, book(6, { facts: scened }), withOptions({}, "structure/cut-candidate", { scenes: true }), new Map([[2, chapter2]]));
    expect(found.map((d) => d.summary)).toEqual([expect.stringMatching(/scene ch2\.s1/u)]);
    expect(found[0]!.range).toMatchObject({ sourceId: "chapter:2" });
    // Scene findings are opt-in.
    expect(run(cutCandidate, book(6, { facts: scened }), {}, new Map([[2, chapter2]]))).toEqual([]);
  });
});

describe("structure/open-questions", () => {
  it("counts open questions per chapter", () => {
    expect(openCounts(book(5, { hooks: [hook("a", 1, "resolved", 3), hook("b", 2, "open", 2)] }), 5)).toEqual([0, 1, 2, 1, 1, 1]);
  });

  it("flags a run of chapters with no open question, and a chapter that opens too many", () => {
    const many = Array.from({ length: 7 }, (_, i) => hook(`h${i}`, 2, "resolved", 3));
    const found = run(openQuestions, book(8, { hooks: [...many, hook("late", 7, "open", 8)] }));
    expect(found.map((d) => d.summary).sort()).toEqual(["ch2 opens 7 questions at once.", "ch3–6 have no open question."]);
    expect(run(openQuestions, book(8, { hooks: [...many, hook("late", 7, "open", 8)] }), withOptions({}, "structure/open-questions", { flatRun: 5, maxNew: 10 }))).toEqual([]);
  });

  it("is skipped for a book that keeps no hooks", () => {
    expect(run(openQuestions, book(9))).toEqual([]);
  });
});

describe("structure/subplot-balance", () => {
  const facts = [fact("Mira", "goal", "find her father", 1), fact("Lena", "goal", "leave the island", 2), fact("Mira", "location", "the vault", 12)];
  const hooks = [
    hook("sister-feud", 2, "open", 3, { expectedPayoff: "Lena and Mira make peace" }),
    hook("sister-letter", 3, "progressing", 4, { expectedPayoff: "What Lena's letter says" }),
    hook("vault", 1, "open", 12, { expectedPayoff: "What Mira finds in the vault" }),
    hook("father", 1, "open", 11, { expectedPayoff: "Where Mira's father went" }),
    hook("storm", 5, "resolved", 9, { expectedPayoff: "Whether Mira survives the storm" }),
  ];

  it("groups hooks by the character they concern, leaving out the one every thread names", () => {
    expect(subplots(book(12, { facts, hooks })).map((s) => [s.key, s.hooks.map((h) => h.hookId)])).toEqual([["Lena", ["sister-feud", "sister-letter"]]]);
  });

  it("flags a subplot that vanishes before the end without resolving", () => {
    const [finding, ...rest] = run(subplotBalance, book(12, { facts, hooks }), finished);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ severity: "warning", chapter: 4, summary: "The Lena subplot vanishes after ch4 (8 chapters before the end) with 2 questions unresolved." });
    expect(run(subplotBalance, book(12, { facts, hooks }), unfinished)[0]).toMatchObject({ severity: "note" });
    expect(run(subplotBalance, book(12, { facts, hooks }), withOptions(finished, "structure/subplot-balance", { gap: 9 }))).toEqual([]);
  });

  it("counts a minor character known only by their trade, so their hooks form a subplot", () => {
    const innkeeper = [kinded("identity", "Rook", "occupation", "innkeeper", 2), fact("Mira", "goal", "find her father", 1)];
    const rook = [hook("rook-bridge", 2, "open", 2, { expectedPayoff: "What Rook saw from the bridge" }), hook("rook-debt", 2, "open", 2, { expectedPayoff: "What Rook owes Mira's father" })];
    expect(subplots(book(10, { facts: innkeeper, hooks: rook })).map((s) => s.key)).toEqual(["Rook"]);
    // A thing with an identity fact of another kind is no character.
    const sword = [kinded("identity", "the sword", "true name", "Dawnbringer", 2)];
    expect(subplots(book(10, { facts: sword, hooks: [hook("sword-a", 2, "open", 2, { expectedPayoff: "Who forged the sword" }), hook("sword-b", 2, "open", 2, { expectedPayoff: "Where the sword goes" })] }))).toEqual([]);
  });

  it("counts a one-hook thread whose character has facts in several chapters, named by a short given name", () => {
    // As GLM settled the lessing-fen corpus book: one hook for the sister's thread, then only facts.
    const sister = [
      kinded("goal", "Bea Ashby", "plan", "move to Halifax", 2), fact("Bea Ashby", "action", "argued with Nell", 4),
      fact("Bea Ashby", "action", "departed for Canada", 5), fact("Nell Ashby", "location", "the mill", 12),
    ];
    const threads = [hook("hook-5", 2, "open", 2, { expectedPayoff: "Resolve conflict with sister Bea over her marriage" })];
    expect(subplots(book(12, { facts: sister, hooks: threads })).map((s) => s.key)).toEqual(["Bea Ashby"]);
    expect(run(subplotBalance, book(12, { facts: sister, hooks: threads }), finished)[0]).toMatchObject({
      severity: "warning", chapter: 5, summary: "The Bea Ashby subplot vanishes after ch5 (7 chapters before the end) with 1 question unresolved.",
    });
    // Facts in only two chapters: one hook is not yet a subplot.
    expect(run(subplotBalance, book(12, { facts: sister.slice(1), hooks: threads }), finished)).toEqual([]);
    expect(run(subplotBalance, book(12, { facts: sister, hooks: threads }), withOptions(finished, "structure/subplot-balance", { minChapters: 4 }))).toEqual([]);
  });

  it("groups hooks linked by dependsOn into one thread", () => {
    const linked = [hook("a", 1, "open", 2), hook("b", 2, "open", 2, { dependsOn: ["a"] })];
    expect(subplots(book(10, { hooks: linked })).map((s) => s.hooks.length)).toEqual([2]);
    expect(run(subplotBalance, book(10, { hooks: linked }), finished)).toHaveLength(1);
  });
});

describe("book plan", () => {
  it("reads target chapters and status from book.json, leniently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plotlint-plan-"));
    try {
      expect(await readBookPlan(dir)).toBeUndefined();
      await writeFile(join(dir, "book.json"), JSON.stringify({ id: "x", targetChapters: 12, status: "active" }), "utf-8");
      expect((await loadBookRuleData(dir)).plan).toEqual({ targetChapters: 12, status: "active" });
      await writeFile(join(dir, "book.json"), "{ not json", "utf-8");
      expect(await readBookPlan(dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
