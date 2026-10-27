import { describe, expect, it } from "vitest";
import type { CurrentStateFact } from "@actalk/inkos-core";
import { checkDelta, checkSnapshot, negativeResource } from "../index.js";
import { delta, fact, snapshot } from "./fixtures.js";

const check = (facts: CurrentStateFact[]) => checkSnapshot(snapshot(facts), [negativeResource]);

describe("continuity/negative-resource", () => {
  it("flags a resource below zero", () => {
    const diagnostics = check([fact("Mira", "gold", "-30", 4)]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "continuity/negative-resource",
      severity: "warning",
      confidence: "extracted",
      chapter: 4,
    });
    expect(diagnostics[0]!.facts).toHaveLength(1);
  });

  it("recognises resources by predicate or unit, in English and Chinese", () => {
    const facts = [
      fact("Mira", "Spirit Stones", "-2", 1),
      fact("Mira", "purse", "-1,200 gold coins", 2),
      fact("Mira", "remaining ammo", "minus 3", 3),
      fact("Mira", "HP", "−5", 4),
      fact("林远", "灵石", "负50", 5),
      fact("林远", "钱袋", "负三十枚金币", 6),
      fact("林远", "法力值", "-10点", 7),
    ];
    expect(check(facts).map((diagnostic) => diagnostic.chapter)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("does not fire on zero, positive, unclear or legitimately signed values", () => {
    expect(check([
      fact("Mira", "gold", "0", 1),
      fact("Mira", "silver", "12", 1),
      fact("Mira", "coins", "-5 to 10", 1),
      fact("Mira", "money", "in debt", 1),
      fact("Mira", "gold change", "-50", 1),
      fact("Mira", "debt", "-50 gold", 1),
      fact("Mira", "bank balance", "-20", 1),
      fact("Mira", "reputation", "-3", 1),
      fact("Mira", "temperature", "-5 degrees", 1),
      fact("Mira", "score", "-4", 1),
      fact("Mira", "camp", "-2", 1),
      fact("林远", "灵石消耗", "-30", 1),
      fact("林远", "好感度", "-10", 1),
    ])).toEqual([]);
  });

  it("cites the value it replaced when a delta takes a resource below zero, only in that chapter", () => {
    let state = snapshot([]);
    ({ next: state } = checkDelta(state, delta(1, [["Mira", "gold", "30"]]), [negativeResource]));
    const result = checkDelta(state, delta(2, [["Mira", "gold", "-20"]]), [negativeResource]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.summary).toContain("goes below zero in chapter 2: 30 to -20");
    expect(result.diagnostics[0]!.facts).toHaveLength(2);
    expect(checkDelta(result.next, delta(3, [["Mira", "mood", "worried"]]), [negativeResource]).diagnostics).toEqual([]);
  });
});
