import { describe, expect, it } from "vitest";
import type { CurrentStateFact } from "@actalk/inkos-core";
import { checkDelta, checkSnapshot, itemFromNowhere, itemTwoHolders } from "../index.js";
import { sameItem, splitItems } from "../rules/item-from-nowhere.js";
import { delta, fact, snapshot } from "./fixtures.js";

const check = (...facts: CurrentStateFact[]) => checkSnapshot(snapshot(facts, 12), [itemFromNowhere]);

describe("continuity/item-from-nowhere", () => {
  it("flags using an item someone else has held since an earlier chapter", () => {
    const diagnostics = check(
      fact("Tomas", "holds", "the brass key", 2),
      fact("Mira", "opens", "the vault with the brass key", 5),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "continuity/item-from-nowhere",
      severity: "warning",
      confidence: "extracted",
      chapter: 5,
      summary: "Mira uses the brass key in chapter 5, but Tomas holds it since chapter 2.",
    });
    expect(diagnostics[0]!.evidence[0]).toMatch(/^use: Mira · opens · the vault with the brass key/u);
    expect(diagnostics[0]!.evidence[1]).toMatch(/^holder: Tomas · holds · the brass key/u);
    expect(diagnostics[0]!.facts).toHaveLength(2);
  });

  it("reads the use vocabulary in English and Chinese, holder-first and item-first", () => {
    for (const [predicate, object] of [
      ["wields", "the Ember Blade"], ["fired", "the Ember Blade at the guard"], ["reads", "his Ember Blade"],
      ["opens with", "Ember Blade"], ["uses", "the Ember Blade"],
    ] as const) {
      expect(check(fact("Ember Blade", "held by", "Tomas", 1), fact("Mira", predicate, object, 3)), predicate).toHaveLength(1);
    }
    expect(check(fact("Tomas", "carries", "Ember Blade", 1), fact("Ember Blade", "wielded by", "Mira", 3))).toHaveLength(1);
    expect(check(fact("苏晴", "持有", "青铜钥匙", 1), fact("林远", "使用", "青铜钥匙", 4)).map((d) => d.chapter)).toEqual([4]);
  });

  it("flags using an item destroyed earlier", () => {
    const [finding] = check(fact("Ember Blade", "status", "shattered", 3), fact("Mira", "wields", "the Ember Blade", 6));
    expect(finding).toMatchObject({ chapter: 6, summary: "Mira uses the Ember Blade in chapter 6, but it was shattered in chapter 3." });
    expect(check(fact("青铜钥匙", "状态", "烧毁", 3), fact("林远", "使用", "青铜钥匙", 6))).toHaveLength(1);
    // Repaired: the destruction ended before the use.
    expect(check(fact("Ember Blade", "status", "shattered", 3, 4), fact("Mira", "wields", "the Ember Blade", 6))).toEqual([]);
    // "broken" is not gone for good.
    expect(check(fact("Ember Blade", "status", "broken", 3), fact("Mira", "wields", "the Ember Blade", 6))).toEqual([]);
  });

  it("flags using an item the user lost or gave away earlier, until they get it back", () => {
    const [lost] = check(fact("Mira", "lost", "the brass key", 2), fact("Mira", "uses", "the brass key", 4));
    expect(lost).toMatchObject({ chapter: 4, summary: "Mira uses the brass key in chapter 4, but lost it in chapter 2 and has not got it back." });
    const [gave] = check(fact("Mira", "gives", "the brass key to Tomas", 2), fact("Mira", "uses", "the brass key", 4));
    expect(gave!.evidence[1]).toMatch(/^earlier: Mira · gives · the brass key to Tomas/u);
    expect(check(fact("林远", "丢失", "青铜钥匙", 2), fact("林远", "使用", "青铜钥匙", 4))).toHaveLength(1);

    // Got back: found again, or handed back.
    expect(check(fact("Mira", "lost", "the brass key", 2), fact("Mira", "found", "the brass key", 3), fact("Mira", "uses", "the brass key", 4))).toEqual([]);
    expect(check(
      fact("Mira", "gives", "the brass key to Tomas", 2),
      fact("Tomas", "gives", "the brass key to Mira", 3),
      fact("Mira", "uses", "the brass key", 4),
    )).toEqual([]);
    // Lost and used in the same chapter: the order is unknown.
    expect(check(fact("Mira", "lost", "the brass key", 4), fact("Mira", "uses", "the brass key", 4))).toEqual([]);
  });

  it("flags giving away a tracked item the giver never had", () => {
    const [finding] = check(
      fact("Tomas", "holds", "the brass key", 1, 2),
      fact("Mira", "gives", "the brass key to Elsa", 5),
    );
    expect(finding).toMatchObject({
      chapter: 5,
      summary: "Mira gives the brass key in chapter 5, but is never recorded with it; Tomas had it in chapter 1.",
    });
    expect(finding!.evidence[1]).toMatch(/^tracked: Tomas · holds · the brass key/u);
  });

  it("reads compound possession objects item by item", () => {
    expect(splitItems("40 silver marks and a brass button")).toEqual(["40 silver marks", "a brass button"]);
    // Tomas possesses the button (a loose possession tracks it), so Mira handing it over comes from nowhere.
    expect(check(
      fact("Tomas", "possesses", "40 silver marks and a brass button", 1),
      fact("Mira", "hands over", "the brass button", 4),
    )).toHaveLength(1);
    // And it counts as having it: Tomas giving it away is fine.
    expect(check(
      fact("Tomas", "possesses", "40 silver marks and a brass button", 1),
      fact("Tomas", "hands over", "the brass button", 4),
    )).toEqual([]);
    expect(check(fact("Tomas", "carries", "the brass key, a lantern", 1), fact("Mira", "uses", "the brass key", 3))).toHaveLength(1);
  });

  it("compares item names by normalized form, only nesting specific names", () => {
    expect(sameItem("The Brass Key", "brass key")).toBe(true);
    expect(sameItem("old brass key", "brass key")).toBe(true);
    expect(sameItem("key", "brass key")).toBe(false);
    expect(sameItem("青铜钥匙", "那把青铜钥匙")).toBe(true);
    expect(sameItem("钥匙", "青铜钥匙")).toBe(false);
    expect(check(fact("Tomas", "holds", "the brass key", 1), fact("Mira", "uses", "the key", 3))).toEqual([]);
  });

  describe("false-alarm guards", () => {
    it("ignores untracked props", () => {
      expect(check(fact("Mira", "uses", "the brass key", 3), fact("Mira", "gives", "the letter to Tomas", 4))).toEqual([]);
      expect(check(fact("林远", "使用", "青铜钥匙", 3))).toEqual([]);
    });

    it("ignores uses by the holder, joint holders and owners of what they hold", () => {
      expect(check(fact("Mira", "holds", "brass key", 1), fact("Mira", "uses", "the brass key", 3))).toEqual([]);
      expect(check(fact("Mira and Tomas", "carry", "map", 1), fact("Mira", "reads", "the map", 3))).toEqual([]);
      expect(check(fact("Mira", "possesses", "the Ember Blade", 1), fact("Mira", "gives", "the Ember Blade to Tomas", 3))).toEqual([]);
    });

    it("does not duplicate item-two-holders when the user also holds the item", () => {
      const facts = [fact("Mira", "holds", "brass key", 1), fact("Tomas", "holds", "brass key", 2), fact("Mira", "uses", "brass key", 3)];
      expect(check(...facts)).toEqual([]);
      expect(checkSnapshot(snapshot(facts), [itemTwoHolders])).toHaveLength(1);
    });

    it("ignores hand-overs recorded in the use's own chapter", () => {
      // Mira gives Tomas the key; the settler records Tomas holding it from the same chapter.
      expect(check(
        fact("Mira", "holds", "brass key", 1, 3),
        fact("Mira", "gives", "the brass key to Tomas", 4),
        fact("Tomas", "holds", "brass key", 4),
      )).toEqual([]);
      // Tomas takes the pistol from Mira later in the chapter she fires it.
      expect(check(fact("Mira", "fires", "the pistol", 4), fact("Tomas", "holds", "the pistol", 4))).toEqual([]);
    });

    it("ignores an earlier holder whose holding ended, and owners elsewhere", () => {
      expect(check(fact("Tomas", "holds", "brass key", 1, 2), fact("Mira", "uses", "the brass key", 4))).toEqual([]);
      expect(check(fact("Baron", "owns", "ruby ring", 1), fact("Mira", "wields", "the ruby ring", 4))).toEqual([]);
    });

    it("ignores a user who got the item after the other holder", () => {
      expect(check(
        fact("Tomas", "holds", "brass key", 1),
        fact("Mira", "took", "the brass key", 3),
        fact("Mira", "uses", "the brass key", 4),
      )).toEqual([]);
    });

    it("ignores kinds of thing and giving to a recipient-first predicate", () => {
      expect(check(fact("Tomas", "holds", "brass key", 1), fact("Mira", "uses", "a brass key", 3))).toEqual([]);
      expect(check(fact("Tomas", "holds", "brass key", 1), fact("Mira", "gives to", "Elsa", 3))).toEqual([]);
      expect(check(fact("Tomas", "holds", "the vault", 1), fact("Mira", "opens", "the vault", 3))).toEqual([]);
    });

    it("does not flag a giver who used the item before", () => {
      expect(check(
        fact("Tomas", "holds", "brass key", 1, 2),
        fact("Mira", "uses", "the brass key", 3),
        fact("Mira", "gives", "the brass key to Elsa", 5),
      )).toEqual([]);
    });
  });

  it("reports only in the delta's chapter under checkDelta", () => {
    let state = snapshot([]);
    ({ next: state } = checkDelta(state, delta(1, [["Tomas", "holds", "brass key"]]), [itemFromNowhere]));
    const result = checkDelta(state, delta(2, [["Mira", "uses", "the brass key"]]), [itemFromNowhere]);
    expect(result.diagnostics.map((d) => d.chapter)).toEqual([2]);
    expect(checkDelta(result.next, delta(3, [["Mira", "mood", "calm"]]), [itemFromNowhere]).diagnostics).toEqual([]);
  });
});
