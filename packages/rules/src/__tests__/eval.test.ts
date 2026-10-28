import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkSnapshot } from "../engine.js";
import { builtinRegistry, builtinRules } from "../engine.js";
import { RuleRegistry } from "../registry.js";
import {
  activeMutators, allMutators, auditorIssueMatches, corpusOf, CORPUS_BOOKS, corpusRoot, evalBook, loadCorpusBook, runRules, scoreAuditor, scoreBooks, scoreRules,
  type AuditorBaseline, type CleanBook, type Mutant, type RuleEvalResult,
} from "../eval/index.js";
import { locateSceneQuote } from "../scene-annotations.js";

let clean: CleanBook;
let books: CleanBook[];
beforeAll(async () => {
  books = await Promise.all(CORPUS_BOOKS.map((name) => loadCorpusBook(name)));
  clean = books.find((book) => book.name === "wenlow")!;
});

const bookOf = (name: string) => books.find((book) => book.name === name)!;
const allMutants = () => allMutators.flatMap((m) => m.mutants(bookOf(corpusOf(m))));

describe("seeded-error corpus", () => {
  it("has five chapters and oracle facts whose evidence quotes are verbatim in their chapter", () => {
    expect(clean.chapters.size).toBe(5);
    expect(clean.facts.length).toBeGreaterThan(40);
    for (const book of books) {
      for (const fact of book.facts) {
        expect(book.chapters.get(fact.sourceChapter), `${book.name}: ${fact.subject} · ${fact.predicate}`).toContain(fact.evidence!.quote);
      }
    }
  });

  it("loads the travel graph, the finished plan, rule options and the author's scene annotations as book data", () => {
    expect(clean.book.travel?.routes.length).toBeGreaterThan(0);
    for (const book of books) {
      expect(book.book.plan, book.name).toEqual({ targetChapters: book.chapters.size, status: "completed" });
      const scenes = book.book.scenes!.scenes;
      expect(scenes.map((scene) => scene.chapter), book.name).toEqual([...book.chapters.keys()]);
      for (const scene of scenes) {
        expect(scene.annotator).toBe("author");
        for (const quote of [scene.turningPoint?.evidence, ...Object.values(scene.evidence)]) {
          expect(locateSceneQuote(scene, quote, book.chapters), `${book.name} ${scene.id}: ${quote}`).not.toBeNull();
        }
      }
    }
    expect(Object.keys(clean.book.config!.rules)).toContain("structure/tension-curve");
  });

  it("has oracle hooks whose setups and payoffs fall inside the book", () => {
    expect(clean.hooks.length).toBeGreaterThanOrEqual(8);
    for (const book of books) {
      for (const hook of book.hooks) {
        expect(hook.startChapter, hook.hookId).toBeGreaterThan(0);
        expect(hook.lastAdvancedChapter, hook.hookId).toBeGreaterThan(hook.startChapter);
        expect(hook.lastAdvancedChapter, hook.hookId).toBeLessThanOrEqual(book.chapters.size);
      }
    }
  });

  it("raises no findings from the built-in rules on the clean books", () => {
    for (const book of books) {
      const { active } = activeMutators(allMutators.filter((m) => corpusOf(m) === book.name));
      expect(runRules({ facts: book.facts, chapters: book.chapters, hooks: book.hooks, book: evalBook(book, active) }, builtinRegistry), book.name).toEqual([]);
    }
  });
});

/** The book's data without its plan: an unfinished book, where only overdue setups count. */
const unfinished = (book: CleanBook) => {
  const { plan: _plan, ...rest } = book.book;
  return rest;
};

describe("real extraction of the clean book", () => {
  // The story state glm-4.5-flash settled from the clean chapters (inkos import
  // chapters, 2026-10-27). Real settler facts are messier than the oracle's, so
  // any finding here is a false alarm a writer would see.
  it("raises no continuity findings", async () => {
    const dir = join(corpusRoot, "wenlow", "extracted", "glm-4.5-flash");
    const read = async (name: string) => JSON.parse(await readFile(join(dir, name), "utf-8"));
    const snapshot = {
      manifest: await read("manifest.json"),
      currentState: await read("current_state.json"),
      hooks: await read("hooks.json"),
      chapterSummaries: await read("chapter_summaries.json"),
    };
    expect(checkSnapshot(snapshot, { chapters: clean.chapters, book: unfinished(clean) })).toEqual([]);
  });

  it("raises at most a couple of structural notes, even read as a finished book", async () => {
    const dir = join(corpusRoot, "wenlow", "extracted", "glm-4.5-flash");
    const read = async (name: string) => JSON.parse(await readFile(join(dir, name), "utf-8"));
    const snapshot = {
      manifest: await read("manifest.json"),
      currentState: await read("current_state.json"),
      hooks: await read("hooks.json"),
      chapterSummaries: await read("chapter_summaries.json"),
    };
    const structure = builtinRules.filter((rule) => rule.layer === "structure");
    const finished = { ...clean.book, plan: { targetChapters: 5, status: "completed" } };
    const found = checkSnapshot(snapshot, { rules: structure, chapters: clean.chapters, book: finished });
    expect(found.length).toBeLessThanOrEqual(2);
    expect(found.every((d) => d.severity === "note")).toBe(true);
    // Unfinished (no plan), only overdue promises count, and none are.
    expect(checkSnapshot(snapshot, { rules: structure, chapters: clean.chapters, book: unfinished(clean) })).toEqual([]);
  });
});

describe("mutators", () => {
  it("build mutants with unique ids that change the prose, and cite quotes that are in the mutated text", () => {
    const mutants = allMutants();
    expect(new Set(mutants.map((m) => m.id)).size).toBe(mutants.length);
    for (const mutant of mutants) {
      const original = bookOf(corpusOf(allMutators.find((m) => m.ruleId === mutant.ruleId)!));
      const changed = [...mutant.chapters].filter(([n, text]) => text !== original.chapters.get(n)).map(([n]) => n);
      expect(changed.length, mutant.id).toBeGreaterThan(0);
      // A continuity slip is seen where it is made or later. A structural one may be
      // reported at an earlier setup (a payoff dropped in ch5 leaves ch2's setup unpaid).
      if (mutant.ruleId.startsWith("continuity/")) expect(Math.min(...changed), mutant.id).toBeLessThanOrEqual(mutant.chapter);
      for (const fact of mutant.facts) {
        if (fact.evidence) expect(mutant.chapters.get(fact.sourceChapter), `${mutant.id}: ${fact.subject} · ${fact.predicate}`).toContain(fact.evidence.quote);
      }
      expect(mutant.match.length, mutant.id).toBeGreaterThan(0);
    }
  });

  it("seed at least ten mutants per rule", () => {
    for (const mutator of allMutators) expect(mutator.mutants(bookOf(corpusOf(mutator))).length, mutator.ruleId).toBeGreaterThanOrEqual(10);
  });

  describe("scored on both books", () => {
  let result: RuleEvalResult;
  beforeAll(() => {
    result = scoreBooks(books, allMutators);
  }, 60_000);

  it("are caught by their rule: every built-in rule, of every layer, has a mutator and catches most of its mutants", () => {
    // The metric rules live in @plotlint/metrics, whose own tests score their mutators.
    for (const rule of builtinRules) {
      const score = result.rules.find((r) => r.ruleId === rule.id)!;
      expect(score.mutants, rule.id).toBeGreaterThanOrEqual(10);
      expect(score.recall!, rule.id).toBeGreaterThanOrEqual(0.5);
      expect(score.cleanFindings, rule.id).toEqual([]);
    }
    // Collateral stays rare: at most one other rule's finding per twenty mutants.
    const collateral = result.rules.reduce((n, r) => n + r.collateral.length, 0);
    expect(collateral / result.mutants.length).toBeLessThan(0.05);
    expect(result.skipped.every((id) => id.startsWith("metrics/"))).toBe(true);
  });

  it("miss only the mutants marked as expected misses", () => {
    const unexpected = result.rules.filter((r) => !r.ruleId.startsWith("continuity/")).flatMap((r) => r.outcomes)
      .filter((o) => !o.caught && !o.description.startsWith("Expected miss"));
    expect(unexpected.map((o) => `${o.id}: ${o.description}`)).toEqual([]);
  });

  it("score book-level rules by any new finding, since they report no chapter", () => {
    const agency = result.rules.find((r) => r.ruleId === "structure/protagonist-agency")!;
    expect(agency.caught).toBeGreaterThan(0);
    expect(agency.outcomes.every((o) => o.echoes.length === 0)).toBe(true);
  });

  it("add up the books: clean findings per chapter of both, and findings tagged with their book", () => {
    expect(result.chapters).toBe(books.reduce((n, book) => n + book.chapters.size, 0));
    const fairPlay = result.rules.find((r) => r.ruleId === "structure/fair-play")!;
    expect(fairPlay.mutants).toBeGreaterThanOrEqual(10);
    expect(fairPlay.outcomes.every((o) => result.mutants.find((m) => m.id === o.id)!.ruleId === "structure/fair-play")).toBe(true);
    for (const rule of result.rules) for (const f of rule.collateral) expect(CORPUS_BOOKS as ReadonlyArray<string>).toContain(f.book);
  });
  });

  it("are skipped when their rule is not registered", () => {
    const registry = new RuleRegistry(builtinRules.filter((rule) => rule.id === "continuity/dead-entity-acts"));
    const result = scoreRules(clean, allMutators, { registry });
    expect(result.skipped).toContain("continuity/two-places-at-once");
    expect(result.skipped).not.toContain("continuity/dead-entity-acts");
    expect(new Set(result.mutants.map((m) => m.ruleId))).toEqual(new Set(["continuity/dead-entity-acts"]));
  });

  it("reject an edit whose passage is not in the chapter", () => {
    const [first] = allMutators;
    const broken: CleanBook = { ...clean, chapters: new Map([...clean.chapters].map(([n, text]) => [n, text.replace(/Absalom Crane/gu, "Old Crane")])) };
    expect(() => first!.mutants(broken)).toThrow(/not found exactly once/u);
  });
});

describe("auditor scoring", () => {
  const issue = (summary: string) => ({ code: "x", summary, evidence: [] });

  it("matches an issue when every keyword group has a word in it", () => {
    expect(auditorIssueMatches(issue("Crane appears alive after his death"), [["Crane"], ["dead", "death"]])).toBe(true);
    expect(auditorIssueMatches(issue("Crane's dialogue is stiff"), [["Crane"], ["dead", "death"]])).toBe(false);
  });

  it("counts clean issues as false positives and recall with and without the clean control", () => {
    const mutants: Mutant[] = allMutants().filter((m) => m.ruleId === "continuity/dead-entity-acts").slice(0, 2);
    const baseline: AuditorBaseline = {
      model: "fixture", repeats: 1,
      clean: [{ id: "clean:4:1", chapter: 4, issues: [issue("Pacing drags in the middle")] }, { id: "clean:5:1", chapter: 5, issues: [] }],
      mutants: [
        { id: mutants[0]!.id, ruleId: mutants[0]!.ruleId, chapter: mutants[0]!.chapter, issues: [issue("Absalom Crane is dead but waits at the abbey"), issue("Weak verbs")] },
        { id: mutants[1]!.id, ruleId: mutants[1]!.ruleId, chapter: mutants[1]!.chapter, issues: [] },
      ],
    };
    const scores = scoreAuditor(baseline, mutants);
    expect(scores.cleanRate).toBe(0.5);
    const rule = scores.rules.find((r) => r.ruleId === "continuity/dead-entity-acts")!;
    expect(rule).toMatchObject({ mutants: 2, caught: 1, caughtStrict: 1, recall: 0.5, collateralRate: 0.5 });
  });
});
