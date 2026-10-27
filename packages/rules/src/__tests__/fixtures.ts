import type { CurrentStateFact, RuntimeStateDelta, RuntimeStateSnapshot } from "@actalk/inkos-core";

export function snapshot(facts: CurrentStateFact[], lastAppliedChapter = 0): RuntimeStateSnapshot {
  return {
    manifest: { schemaVersion: 2, language: "en", lastAppliedChapter, projectionVersion: 1 },
    currentState: { chapter: lastAppliedChapter, facts },
    hooks: { hooks: [] },
    chapterSummaries: { rows: [] },
  };
}

export const fact = (subject: string, predicate: string, object: string, from: number, until: number | null = null): CurrentStateFact => ({
  subject, predicate, object, validFromChapter: from, validUntilChapter: until, sourceChapter: from,
});

export function delta(chapter: number, upsert: Array<[string, string, string]>, expire: Array<[string, string]> = []): RuntimeStateDelta {
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
