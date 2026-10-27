import { describe, expect, it } from "vitest";
import type { CurrentStateFact } from "@actalk/inkos-core";
import { checkDelta, checkSnapshot, singleValuedConflict } from "../index.js";
import { delta, fact, snapshot } from "./fixtures.js";

const check = (facts: CurrentStateFact[]) => checkSnapshot(snapshot(facts), [singleValuedConflict]);

describe("continuity/single-valued-conflict", () => {
  it("flags a character recorded as both alive and dead", () => {
    const diagnostics = check([fact("Mira", "status", "alive", 1), fact("Mira", "condition", "dead", 6)]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "continuity/single-valued-conflict",
      severity: "warning",
      confidence: "extracted",
      chapter: 6,
    });
    expect(diagnostics[0]!.summary).toContain("both alive and dead");
    expect(check([fact("林远", "存活", "是", 2), fact("林远", "状态", "已死亡", 3)]).map((d) => d.chapter)).toEqual([3]);
  });

  it("flags two different ages at once, reading units and Chinese numerals", () => {
    expect(check([fact("Mira", "age", "17", 1), fact("Mira", "年龄", "18岁", 9)]).map((d) => d.summary))
      .toEqual(["Mira has two ages in chapter 9: 17 and 18."]);
    expect(check([fact("Mira", "age", "17 years old", 1), fact("Mira", "年龄", "十七岁", 1)])).toEqual([]);
  });

  it("does not fire on sequential values, unclear values or other subjects", () => {
    expect(check([
      fact("Mira", "status", "alive", 1, 5), fact("Mira", "status", "dead", 6),
      fact("Mira", "age", "17", 1, 9), fact("Mira", "年龄", "18", 10),
      fact("Tomas", "status", "alive but wounded", 1), fact("Tomas", "condition", "dead", 1),
      fact("Tomas", "age", "about 40", 1), fact("Tomas", "年龄", "41", 1),
      fact("Ana", "年龄", "虚岁十八", 1), fact("Ana", "age", "17", 1),
      fact("Ana", "status", "alive", 1), fact("Bo", "status", "dead", 1),
    ])).toEqual([]);
  });

  it("does not duplicate dead-entity-acts and reports only in the delta's chapter", () => {
    let state = snapshot([]);
    ({ next: state } = checkDelta(state, delta(1, [["Mira", "status", "alive"]])));
    const result = checkDelta(state, delta(2, [["Mira", "生死", "死亡"]]));
    expect(result.diagnostics.map((d) => d.ruleId)).toEqual(["continuity/single-valued-conflict"]);
    expect(checkDelta(result.next, delta(3, [["Tomas", "mood", "calm"]])).diagnostics).toEqual([]);
  });
});
