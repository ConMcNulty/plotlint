import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkSnapshot } from "../engine.js";
import { builtinRegistry, builtinRules } from "../engine.js";
import { RuleRegistry } from "../registry.js";
import {
  activeMutators, allMutators, auditorIssueMatches, corpusRoot, evalBook, loadCorpusBook, runRules, scoreAuditor, scoreRules,
  type AuditorBaseline, type CleanBook, type Mutant,
} from "../eval/index.js";

let clean: CleanBook;
beforeAll(async () => {
  clean = await loadCorpusBook("wenlow");
});

const allMutants = () => allMutators.flatMap((m) => m.mutants(clean));

describe("seeded-error corpus", () => {
  it("has five chapters and oracle facts whose evidence quotes are verbatim in their chapter", () => {
    expect(clean.chapters.size).toBe(5);
    expect(clean.facts.length).toBeGreaterThan(40);
    for (const fact of clean.facts) {
      expect(clean.chapters.get(fact.sourceChapter), `${fact.subject} · ${fact.predicate}`).toContain(fact.evidence!.quote);
    }
  });

  it("loads the travel graph as book data", () => {
    expect(clean.book.travel?.routes.length).toBeGreaterThan(0);
  });

  it("raises no findings from the built-in rules on the clean book", () => {
    const { active } = activeMutators(allMutators);
    expect(runRules(clean.facts, clean.chapters, evalBook(clean, active), builtinRegistry)).toEqual([]);
  });
});

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
    expect(checkSnapshot(snapshot, { chapters: clean.chapters, book: clean.book })).toEqual([]);
  });
});

describe("mutators", () => {
  it("build mutants with unique ids that change the prose, and cite quotes that are in the mutated text", () => {
    const mutants = allMutants();
    expect(new Set(mutants.map((m) => m.id)).size).toBe(mutants.length);
    for (const mutant of mutants) {
      const changed = [...mutant.chapters].filter(([n, text]) => text !== clean.chapters.get(n)).map(([n]) => n);
      expect(changed.length, mutant.id).toBeGreaterThan(0);
      expect(Math.min(...changed), mutant.id).toBeLessThanOrEqual(mutant.chapter);
      for (const fact of mutant.facts) {
        if (fact.evidence) expect(mutant.chapters.get(fact.sourceChapter), `${mutant.id}: ${fact.subject} · ${fact.predicate}`).toContain(fact.evidence.quote);
      }
      expect(mutant.match.length, mutant.id).toBeGreaterThan(0);
    }
  });

  it("seed at least ten mutants per rule", () => {
    for (const mutator of allMutators) expect(mutator.mutants(clean).length, mutator.ruleId).toBeGreaterThanOrEqual(10);
  });

  it("are caught by their rule: every registered continuity rule has a mutator and catches most of its mutants", () => {
    const result = scoreRules(clean, allMutators);
    // Structure rules read scene annotations, which the seeded mutants do not change.
    for (const rule of builtinRules.filter((entry) => entry.layer === "continuity")) {
      const score = result.rules.find((r) => r.ruleId === rule.id)!;
      expect(score.mutants, rule.id).toBeGreaterThanOrEqual(10);
      expect(score.recall!, rule.id).toBeGreaterThanOrEqual(0.5);
      expect(score.cleanFindings, rule.id).toEqual([]);
    }
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
