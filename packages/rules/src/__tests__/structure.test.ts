import { describe, expect, it } from "vitest";
import {
  builtinRegistry, checkSnapshot, goalConflictOutcome, povDiscipline, protagonistAgency, protagonistOf, sameCharacter, SceneAnnotationSchema, sceneTurn,
  SceneAnnotationsFileSchema, tensionCurveRule, type BookRuleData, type Rule, type SceneAnnotationInput,
} from "../index.js";
import { snapshot } from "./fixtures.js";

type Spec = Partial<SceneAnnotationInput> & { at: string };

/** A scene entry: `at` is "3" (ch3.s1) or "3.2" (ch3.s2); fields default to a complete, turning scene. */
function scene({ at, ...rest }: Spec): SceneAnnotationInput {
  const [chapter, number = 1] = at.split(".").map(Number) as [number, number?];
  return {
    id: `ch${chapter}.s${number}`, chapter, scene: number, annotator: "llm@test-model",
    pov: "Mira", goal: "get the ledger", opposition: "Pell", outcome: "success",
    valueStart: { axis: "safety", value: -1 }, valueEnd: { axis: "safety", value: 1 }, stakes: 5,
    ...rest,
  };
}

const flat = { valueStart: { axis: "safety", value: 0 }, valueEnd: { axis: "Safety", value: 0 } };

function run(rule: Rule, specs: Spec[], options: { config?: Record<string, unknown>; protagonist?: string; chapters?: Map<number, string> } = {}) {
  const book: BookRuleData = {
    scenes: SceneAnnotationsFileSchema.parse({ version: 1, ...(options.protagonist ? { protagonist: options.protagonist } : {}), scenes: specs.map(scene) }),
    ...(options.config ? { config: { version: 1, rules: { [rule.id]: { options: options.config } } } } : {}),
  };
  return checkSnapshot(snapshot([], 20), { rules: [rule], book, ...(options.chapters ? { chapters: options.chapters } : {}) });
}

describe("structure rules", () => {
  it("are registered, and silent without annotations", () => {
    for (const id of ["structure/scene-turn", "structure/goal-conflict-outcome", "structure/protagonist-agency", "structure/tension-curve", "structure/pov-discipline"]) {
      const rule = builtinRegistry.get(id);
      expect(rule?.layer).toBe("structure");
      expect(rule?.source).toBeTruthy();
      expect(checkSnapshot(snapshot([], 3), { rules: [rule!] })).toEqual([]);
    }
  });
});

describe("structure/scene-turn", () => {
  it("flags a run of scenes that end where they began, ranged at the first scene's quote", () => {
    const chapters = new Map([[14, "# Chapter 14\n\nThey waited in the boat all night, and nothing came.\n"]]);
    const diagnostics = run(sceneTurn, [
      { at: "13" },
      { at: "14", ...flat, evidence: { outcome: "nothing came" } }, { at: "15", ...flat }, { at: "16.1", ...flat }, { at: "16.2", ...flat },
      { at: "17" },
    ], { chapters });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "structure/scene-turn", severity: "warning", confidence: "extracted", chapter: 14,
      summary: "Scenes ch14.s1 to ch16.s2 end where they began: 4 scenes in a row with no change in their value.",
      range: { sourceId: "chapter:14" },
    });
    const range = diagnostics[0]!.range!;
    expect(chapters.get(14)!.slice(range.start, range.end)).toBe("nothing came");
  });

  it("respects minRun, and does not count a change of axis or a missing value as flat", () => {
    const specs: Spec[] = [{ at: "1", ...flat }, { at: "2", ...flat }, { at: "3" }];
    expect(run(sceneTurn, specs)).toEqual([]);
    expect(run(sceneTurn, specs, { config: { minRun: 2 } })).toHaveLength(1);
    expect(run(sceneTurn, [
      { at: "1", ...flat }, { at: "2", valueStart: { axis: "safety", value: 0 }, valueEnd: { axis: "trust", value: 0 } },
      { at: "3", ...flat }, { at: "4", valueStart: null, valueEnd: null }, { at: "5", ...flat },
    ], { config: { minRun: 2 } })).toEqual([]);
  });
});

describe("structure/goal-conflict-outcome", () => {
  const noOpposition = { opposition: null };

  it("flags a stretch where most scenes lack opposition", () => {
    const specs: Spec[] = [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((ch) => ({ at: String(ch) })),
      { at: "10", ...noOpposition }, { at: "11", ...noOpposition }, { at: "11.2" }, { at: "12", ...noOpposition },
      { at: "12.2", ...noOpposition, goal: null }, { at: "13", ...noOpposition }, { at: "13.2" }, { at: "14", ...noOpposition }, { at: "14.2" },
      ...[15, 16, 17, 18, 19].map((ch) => ({ at: String(ch) })),
    ];
    const diagnostics = run(goalConflictOutcome, specs);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: "warning", confidence: "extracted", chapter: 10,
      summary: "No opposition in 6 of 9 scenes in ch 10–14; no goal in 1.",
    });
    expect(diagnostics[0]!.evidence[0]).toBe("ch10.s1: no opposition (goal: get the ledger)");
  });

  it("stays quiet below the share or the scene count, and takes options", () => {
    const half: Spec[] = [{ at: "1", ...noOpposition }, { at: "2", ...noOpposition }, { at: "3" }, { at: "4" }, { at: "5", ...noOpposition }, { at: "6" }];
    expect(run(goalConflictOutcome, half)).toEqual([]);
    expect(run(goalConflictOutcome, half, { config: { maxMissingShare: 0.4, minScenes: 3, window: 6 } })).toHaveLength(1);
    expect(run(goalConflictOutcome, [{ at: "1", goal: null }, { at: "2", goal: null }, { at: "3", goal: null }])).toEqual([]);
  });
});

describe("structure/protagonist-agency", () => {
  const turn = (causedBy: "protagonist" | "other" | "circumstance", by?: string) =>
    ({ turningPoint: { description: "things change", causedBy, ...(by ? { by } : {}), evidence: "x x x" } });

  it("flags a protagonist who causes few turning points, inferring the protagonist from POV", () => {
    const diagnostics = run(protagonistAgency, [
      { at: "1", ...turn("protagonist", "Mira") }, { at: "2", ...turn("other", "Pell") }, { at: "3", ...turn("circumstance") },
      { at: "4", pov: "Tomas", ...turn("other", "Tomas") }, { at: "5", ...turn("other", "Pell Ostrander") }, { at: "6", ...turn("circumstance", "the storm") },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "structure/protagonist-agency", severity: "warning", confidence: "extracted",
      summary: "Mira causes 1 of 6 turning points (17%); the rest are done to them by others or by circumstance.",
    });
    expect(diagnostics[0]!.chapter).toBeUndefined();
  });

  it("uses the declared protagonist, matches names by whole words, and needs enough turning points", () => {
    const specs: Spec[] = [
      { at: "1", ...turn("protagonist") }, { at: "2", ...turn("other", "Mira Okonkwo-Hale") }, { at: "3", ...turn("other", "Pell") },
      { at: "4", ...turn("other", "Pell") }, { at: "5", ...turn("other", "Pell") },
    ];
    expect(run(protagonistAgency, specs, { protagonist: "Mira" })).toEqual([]); // 2 of 5
    expect(run(protagonistAgency, specs, { protagonist: "Pell" })).toEqual([]); // 3 of 5
    expect(run(protagonistAgency, specs, { protagonist: "Tomas" })[0]!.summary).toContain("Tomas causes 1 of 5");
    expect(run(protagonistAgency, specs.slice(0, 4), { protagonist: "Tomas" })).toEqual([]);
    expect(protagonistOf([scene({ at: "1", pov: "Tomas" }), scene({ at: "2", pov: "Mira Okonkwo-Hale" }), scene({ at: "3", pov: "Mira" })]
      .map((entry) => SceneAnnotationSchema.parse(entry)))).toBe("Mira Okonkwo-Hale");
    expect(sameCharacter("Mira", "Mira Okonkwo-Hale")).toBe(true);
    expect(sameCharacter("Mir", "Mira Okonkwo-Hale")).toBe(false);
    expect(sameCharacter("黛玉", "林黛玉")).toBe(true);
    expect(sameCharacter("林", "林黛玉")).toBe(false);
  });
});

describe("structure/tension-curve", () => {
  const stakes = (values: number[]): Spec[] => values.map((value, index) => ({ at: String(index + 1), stakes: value }));

  it("notes a long flat run as a judged note", () => {
    const diagnostics = run(tensionCurveRule, stakes([2, 4, 5, 5, 4, 5, 7, 9]));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: "note", confidence: "judged", chapter: 2,
      summary: "Tension stays flat across ch 2–6: stakes between 4 and 5 for 5 chapters.",
    });
    // A short book where every chapter sits at the same stakes says more about the annotator than the book.
    expect(run(tensionCurveRule, stakes([7, 7, 7, 6, 7]))).toEqual([]);
    expect(run(tensionCurveRule, stakes([7, 7, 7, 6, 7]), { config: { minChapters: 5 } })).toHaveLength(1);
  });

  it("notes an early peak only in a finished book, taking the highest scene per chapter", () => {
    const specs: Spec[] = [...stakes([3, 9, 2, 5, 3, 6, 4, 5, 6, 7]), { at: "10.2", stakes: 8 }];
    expect(run(tensionCurveRule, specs, { config: { flatRun: 20 } })).toEqual([]);
    const diagnostics = run(tensionCurveRule, specs, { config: { flatRun: 20, finished: true } });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: "note", confidence: "judged", chapter: 2 });
    expect(diagnostics[0]!.summary).toBe("Peak tension is in ch 2 of 10 annotated chapters (20% of the way through), and the stakes never return to it.");
    expect(run(tensionCurveRule, [...specs, { at: "11", stakes: 9 }], { config: { flatRun: 20, finished: true } })).toEqual([]);
  });

  it("stays judged at note even when rules.json raises its severity", () => {
    const book: BookRuleData = {
      scenes: SceneAnnotationsFileSchema.parse({ version: 1, scenes: stakes([5, 5, 5, 5, 5, 5, 5, 5]).map(scene) }),
      config: { version: 1, rules: { "structure/tension-curve": "error" } },
    };
    expect(checkSnapshot(snapshot([], 4), { rules: [tensionCurveRule], book }).map((d) => d.severity)).toEqual(["note"]);
  });
});

describe("structure/pov-discipline", () => {
  it("notes each reported break, ranged at its passage", () => {
    const text = "# Chapter 2\n\nMira watched him go. Pell secretly hated her for it.\n";
    const diagnostics = run(povDiscipline, [
      { at: "1" },
      { at: "2", povBreaks: [{ quote: "Pell secretly hated her for it.", note: "Mira cannot know what Pell feels" }] },
    ], { chapters: new Map([[2, text]]) });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "structure/pov-discipline", severity: "note", confidence: "judged", chapter: 2,
      summary: "Possible viewpoint break in ch2.s1 (POV: Mira): Mira cannot know what Pell feels",
      sourceRefs: [{ sourceId: "chapter:2", quote: "Pell secretly hated her for it." }],
    });
    expect(text.slice(diagnostics[0]!.range!.start, diagnostics[0]!.range!.end)).toBe("Pell secretly hated her for it.");
  });

  it("still reports a break whose passage was edited away, without a range", () => {
    const diagnostics = run(povDiscipline, [{ at: "2", povBreaks: [{ quote: "gone now", note: "n" }] }], { chapters: new Map([[2, "# x\n\nother text\n"]]) });
    expect(diagnostics[0]!.range).toBeUndefined();
  });
});
