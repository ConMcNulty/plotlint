import { describe, expect, it } from "vitest";
import type { CurrentStateFact, RuntimeStateDelta, RuntimeStateSnapshot } from "@actalk/inkos-core";
import { checkDelta, checkSnapshot } from "../index.js";

function snapshot(facts: CurrentStateFact[], lastAppliedChapter = 0): RuntimeStateSnapshot {
  return {
    manifest: { schemaVersion: 2, language: "en", lastAppliedChapter, projectionVersion: 1 },
    currentState: { chapter: lastAppliedChapter, facts },
    hooks: { hooks: [] },
    chapterSummaries: { rows: [] },
  };
}

const fact = (subject: string, predicate: string, object: string, from: number, until: number | null = null): CurrentStateFact => ({
  subject, predicate, object, validFromChapter: from, validUntilChapter: until, sourceChapter: from,
});

function delta(chapter: number, upsert: Array<[string, string, string]>, expire: Array<[string, string]> = []): RuntimeStateDelta {
  return {
    chapter,
    factOps: {
      upsert: upsert.map(([subject, predicate, object]) => ({ subject, predicate, object })),
      expire: expire.map(([subject, predicate]) => ({ subject, predicate })),
    },
    hookOps: { upsert: [], mention: [], resolve: [], defer: [] },
    newHookCandidates: [],
  };
}

describe("continuity/dead-entity-acts", () => {
  it("flags new state for a character after their death, citing both facts", () => {
    const diagnostics = checkSnapshot(snapshot([
      fact("Mira", "status", "dead", 5),
      fact("Mira", "location", "harbour", 7),
      fact("Mira", "holds", "brass key", 7),
    ], 7));

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "continuity/dead-entity-acts",
      severity: "warning",
      confidence: "extracted",
      chapter: 7,
    });
    expect(diagnostics[0]!.facts).toHaveLength(3);
    expect(diagnostics[0]!.evidence[0]).toContain("Mira · status · dead");
  });

  it("ignores facts from before the death and posthumous facts", () => {
    expect(checkSnapshot(snapshot([
      fact("Mira", "location", "harbour", 2),
      fact("Mira", "status", "dead", 5),
      fact("Mira", "cause_of_death", "drowning", 6),
      fact("Mira", "buried at", "chapel yard", 6),
      fact("Tomas", "location", "chapel yard", 6),
    ], 6))).toEqual([]);
  });

  it("ignores what an inquest finds about the dead", () => {
    // As GLM extracted it from the lessing-fen corpus book: the inquest in ch3.
    expect(checkSnapshot(snapshot([
      fact("Owen Tarrant", "status", "drowned in the mill race", 1),
      fact("Owen Tarrant", "ruling", "accidental", 3),
      fact("Owen Tarrant", "signs_of_struggle", "none", 3),
      fact("Owen Tarrant", "inquest verdict", "unlawful killing", 13),
    ], 13))).toEqual([]);
    expect(checkSnapshot(snapshot([
      fact("Owen Tarrant", "status", "drowned in the mill race", 1),
      fact("Owen Tarrant", "location", "the mill office", 3),
    ], 3)).map((d) => d.chapter)).toEqual([3]);
  });

  it("leaves a character whose death fact was later expired to dead-then-alive", () => {
    expect(checkSnapshot(snapshot([
      fact("Mira", "status", "dead", 5, 8),
      fact("Mira", "status", "alive", 9),
      fact("Mira", "location", "harbour", 9),
    ], 9)).map((d) => d.ruleId)).toEqual(["continuity/dead-then-alive"]);
  });

  it("recognises death written as a copula or as the manner of death", () => {
    // As GLM extracted it from the phase 1 test manuscript.
    const diagnostics = checkSnapshot(snapshot([
      fact("Captain Aurel Harrow", "is", "lighthouse keeper", 1, 1),
      fact("Captain Aurel Harrow", "is", "dead", 2),
      fact("Captain Aurel Harrow", "died from", "throat cut and wrists tied with fishing line", 2),
      fact("Captain Aurel Harrow", "appears", "dead but present at lantern house", 3),
    ], 3));
    expect(diagnostics.map((diagnostic) => [diagnostic.ruleId, diagnostic.chapter])).toEqual([["continuity/dead-entity-acts", 3]]);

    expect(checkSnapshot(snapshot([
      fact("Mira", "died from", "a cut throat", 2),
      fact("Mira", "location", "harbour", 4),
    ], 4)).map((diagnostic) => diagnostic.chapter)).toEqual([4]);
  });

  it("reads a death status that names its manner", () => {
    // As GLM extracted it on a second import of the test manuscript.
    expect(checkSnapshot(snapshot([
      fact("Captain Aurel Harrow", "status", "Deceased", 1, 1),
      fact("Captain Aurel Harrow", "status", "Murdered with throat cut", 2),
      fact("Captain Aurel Harrow", "location", "Lantern house", 3),
    ], 3)).map((diagnostic) => diagnostic.chapter)).toEqual([3]);

    expect(checkSnapshot(snapshot([
      fact("Mira", "status", "dead tired", 2),
      fact("Mira", "location", "harbour", 3),
    ], 3))).toEqual([]);
  });

  it("does not read other copula facts as status", () => {
    expect(checkSnapshot(snapshot([
      fact("Harrow", "is", "lighthouse keeper", 1),
      fact("Harrow", "is", "a liar", 2),
    ], 2))).toEqual([]);
  });

  it("recognises Chinese status facts", () => {
    const diagnostics = checkSnapshot(snapshot([
      fact("林远", "状态", "已死亡", 3),
      fact("林远", "位置", "城门", 4),
    ], 4));
    expect(diagnostics.map((diagnostic) => diagnostic.chapter)).toEqual([4]);
  });

  it("checks a settler delta through the InkOS reducer and reports only that chapter", () => {
    let state = snapshot([]);
    ({ next: state } = checkDelta(state, delta(1, [["Mira", "status", "dead"]])));
    const { next, diagnostics } = checkDelta(state, delta(2, [["Mira", "location", "harbour"], ["Tomas", "location", "harbour"]]));

    expect(next.manifest.lastAppliedChapter).toBe(2);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.summary).toContain("Mira");
    expect(checkDelta(next, delta(3, [["Tomas", "mood", "grieving"]])).diagnostics).toEqual([]);
  });
});
