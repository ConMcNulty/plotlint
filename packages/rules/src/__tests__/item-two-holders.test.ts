import { describe, expect, it } from "vitest";
import type { CurrentStateFact } from "@actalk/inkos-core";
import { checkDelta, checkSnapshot, itemTwoHolders } from "../index.js";
import { delta, fact, snapshot } from "./fixtures.js";

const check = (facts: CurrentStateFact[]) => checkSnapshot(snapshot(facts), [itemTwoHolders]);

describe("continuity/item-two-holders", () => {
  it("flags one item held by two characters at once", () => {
    const diagnostics = check([
      fact("Mira", "holds", "the brass key", 2),
      fact("Tomas", "carries", "Brass Key", 4),
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "continuity/item-two-holders",
      severity: "warning",
      confidence: "extracted",
      chapter: 4,
    });
    expect(diagnostics[0]!.summary).toContain("held by both Mira and Tomas");
    expect(diagnostics[0]!.facts).toHaveLength(2);
  });

  it("reads item-first facts and Chinese predicates", () => {
    expect(check([fact("Mira", "holds", "brass key", 1), fact("brass key", "held by", "Tomas", 1)])).toHaveLength(1);
    expect(check([fact("林远", "持有", "青铜钥匙", 3), fact("青铜钥匙", "持有者", "苏晴", 3)]).map((d) => d.chapter)).toEqual([3]);
  });

  it("compares holding with holding and owning with owning only", () => {
    // The thief holds what the merchant owns.
    expect(check([fact("Thief", "holds", "ruby ring", 1), fact("Merchant", "owns", "ruby ring", 1)])).toEqual([]);
    expect(check([fact("Merchant", "owns", "ruby ring", 1), fact("ruby ring", "owner", "Baron", 2)])).toHaveLength(1);
  });

  it("does not fire for hand-overs, the same holder, joint holders or kinds of thing", () => {
    expect(check([fact("Mira", "holds", "brass key", 1, 3), fact("Tomas", "holds", "brass key", 4)])).toEqual([]);
    expect(check([fact("Mira", "holds", "brass key", 1), fact("brass key", "held by", "mira", 1)])).toEqual([]);
    expect(check([fact("Mira", "holds", "map", 1), fact("Mira and Tomas", "holds", "map", 1)])).toEqual([]);
    expect(check([
      fact("Mira", "carries", "a sword", 1), fact("Tomas", "carries", "a sword", 1),
      fact("Mira", "carries", "two arrows", 1), fact("Tomas", "carries", "two arrows", 1),
      fact("林远", "携带", "一把剑", 1), fact("苏晴", "携带", "一把剑", 1),
      fact("Mira", "has", "a fever", 1), fact("Tomas", "has", "a fever", 1),
      fact("Mira", "has", "sister", 1), fact("Tomas", "has", "sister", 1),
      fact("Mira", "keeps", "secret", 1), fact("Tomas", "keeps", "secret", 1),
    ])).toEqual([]);
  });

  it("reports only in the delta's chapter under checkDelta", () => {
    let state = snapshot([]);
    ({ next: state } = checkDelta(state, delta(1, [["Mira", "holds", "brass key"]]), [itemTwoHolders]));
    const result = checkDelta(state, delta(2, [["Tomas", "holds", "brass key"]]), [itemTwoHolders]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.chapter)).toEqual([2]);
    // Expiring Mira's holding in the same chapter as the hand-over clears it.
    const handedOver = checkDelta(state, delta(2, [["Tomas", "holds", "brass key"]], [["Mira", "holds"]]), [itemTwoHolders]);
    expect(handedOver.diagnostics).toEqual([]);
    expect(checkDelta(result.next, delta(3, [["Mira", "mood", "angry"]]), [itemTwoHolders]).diagnostics).toEqual([]);
  });
});
