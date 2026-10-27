import { describe, expect, it } from "vitest";
import type { CurrentStateFact } from "@actalk/inkos-core";
import { checkSnapshot, worldRuleBroken } from "../index.js";
import { fact, kinded, snapshot } from "./fixtures.js";

const check = (...facts: CurrentStateFact[]) => checkSnapshot(snapshot(facts, 12), [worldRuleBroken]);
const rule = (...args: Parameters<typeof fact>) => kinded("world_rule", ...args);

describe("continuity/world-rule-broken", () => {
  describe("use limits", () => {
    it("flags more uses in a chapter than the rule allows per day, citing the rule and each use", () => {
      const diagnostics = check(
        rule("Eye of Dawn", "can be used", "at most once per day", 1),
        fact("Mira", "uses", "the Eye of Dawn", 4),
        fact("Mira", "used again", "Eye of Dawn", 4),
      );
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        ruleId: "continuity/world-rule-broken",
        severity: "warning",
        confidence: "extracted",
        chapter: 4,
      });
      expect(diagnostics[0]!.summary).toContain("uses Eye of Dawn 2 times in chapter 4, but the world rule allows 1");
      expect(diagnostics[0]!.evidence[0]).toMatch(/^rule: Eye of Dawn · can be used · at most once per day/u);
      expect(diagnostics[0]!.facts).toHaveLength(3);
    });

    it("counts per user and per chapter, within the limit and while the rule holds", () => {
      const eye = rule("Eye of Dawn", "can be used", "once per day", 1);
      expect(check(eye, fact("Mira", "uses", "Eye of Dawn", 4), fact("Mira", "uses", "Eye of Dawn", 5))).toEqual([]);
      expect(check(eye, fact("Mira", "uses", "Eye of Dawn", 4), fact("Tomas", "uses", "Eye of Dawn", 4))).toEqual([]);
      expect(check(
        rule("Eye of Dawn", "can be used", "twice a day", 1),
        fact("Mira", "uses", "Eye of Dawn", 4), fact("Mira", "used", "Eye of Dawn again", 4),
      )).toEqual([]);
      // The rule was lifted before the uses.
      expect(check(
        rule("Eye of Dawn", "can be used", "once per day", 1, 2),
        fact("Mira", "uses", "Eye of Dawn", 4), fact("Mira", "used", "Eye of Dawn again", 4),
      )).toEqual([]);
    });

    it("counts every cast for a spell limit, and reads the rule's own verb", () => {
      expect(check(
        rule("magic", "limit", "three spells per night", 1),
        fact("Mira", "casts", "fireball", 3), fact("Mira", "cast", "a ward", 3),
        fact("Mira", "casts spell", "frost", 3), fact("Mira", "casting", "light", 3),
      ).map((d) => d.chapter)).toEqual([3]);
      expect(check(
        rule("fireball", "can be cast", "only twice per day", 1),
        fact("Mira", "casts", "fireball", 3), fact("Mira", "cast", "fireball at Tomas", 3), fact("Mira", "casts again", "a fireball", 3),
      )).toHaveLength(1);
    });

    it("reads once-ever limits across chapters", () => {
      const [finding] = check(
        rule("Phoenix Feather", "can be used", "only once", 1),
        fact("Mira", "uses", "the Phoenix Feather", 3),
        fact("Mira", "used", "the Phoenix Feather", 8),
      );
      expect(finding).toMatchObject({ chapter: 8 });
    });

    it("reads Chinese limits", () => {
      expect(check(
        rule("镇魂铃", "使用限制", "每天只能使用一次", 1),
        fact("林远", "使用", "镇魂铃", 5), fact("林远", "动用", "镇魂铃", 5),
      ).map((d) => d.chapter)).toEqual([5]);
      expect(check(rule("镇魂铃", "使用限制", "每天只能使用一次", 1), fact("林远", "使用", "镇魂铃", 5))).toEqual([]);
    });

    it("ignores limits it cannot parse and unlabelled facts", () => {
      const uses = [fact("Mira", "uses", "Eye of Dawn", 4), fact("Mira", "used again", "Eye of Dawn", 4)];
      expect(check(rule("Eye of Dawn", "can be used", "sparingly", 1), ...uses)).toEqual([]);
      expect(check(rule("Eye of Dawn", "can be used", "once per week", 1), ...uses)).toEqual([]);
      expect(check(fact("Eye of Dawn", "can be used", "once per day", 1), ...uses)).toEqual([]);
    });
  });

  describe("maximums", () => {
    it("flags an amount above a stated maximum", () => {
      const [finding] = check(fact("灵力", "上限", "100", 1), fact("林远", "灵力", "150", 4));
      expect(finding).toMatchObject({ chapter: 4 });
      expect(finding!.summary).toContain("above the stated maximum of 100");
      expect(finding!.evidence).toHaveLength(2);
      expect(check(rule("mana", "maximum", "100 points", 1), fact("Mira", "current mana", "120", 3))).toHaveLength(1);
      expect(check(rule("mana", "cannot exceed", "at most 100", 1), fact("Mira", "has", "130 mana", 3))).toHaveLength(1);
    });

    it("scopes a cap named in the predicate to its subject", () => {
      expect(check(fact("Mira", "max mana", "100", 1), fact("Mira", "mana", "120", 3))).toHaveLength(1);
      expect(check(fact("林远", "灵力上限", "100", 1), fact("林远", "灵力", "150", 3))).toHaveLength(1);
      expect(check(fact("Mira", "max mana", "100", 1), fact("Tomas", "mana", "120", 3))).toEqual([]);
    });

    it("ignores amounts within the cap, other resources, changes and a raised cap", () => {
      expect(check(fact("灵力", "上限", "100", 1), fact("林远", "灵力", "100", 4))).toEqual([]);
      expect(check(fact("灵力", "上限", "100", 1), fact("林远", "灵石", "500", 4))).toEqual([]);
      expect(check(fact("mana", "maximum", "100", 1), fact("Mira", "mana spent", "150", 4))).toEqual([]);
      expect(check(fact("mana", "maximum", "100", 1), fact("Mira", "mana regen", "150", 4))).toEqual([]);
      expect(check(fact("林远", "灵力上限", "100", 1, 3), fact("林远", "灵力上限", "200", 4), fact("林远", "灵力", "150", 4))).toEqual([]);
    });
  });

  describe("prohibitions", () => {
    it("flags a forbidden act, excusing anyone with the named item", () => {
      const vault = rule("no one", "can enter", "the vault without the key", 1);
      const [finding] = check(vault, fact("Mira", "enters", "the vault", 5));
      expect(finding).toMatchObject({ chapter: 5 });
      expect(finding!.summary).toContain("which the world rule forbids");
      expect(finding!.evidence[1]).toMatch(/^breaks it: Mira · enters · the vault/u);
      expect(check(vault, fact("Mira", "location", "the vault", 5))).toHaveLength(1);

      expect(check(vault, fact("Mira", "holds", "the brass key", 2), fact("Mira", "entered", "the vault", 5))).toEqual([]);
      expect(check(vault, fact("Mira", "enters", "the vault with the key", 5))).toEqual([]);
      expect(check(vault, fact("Mira", "tries to enter", "the vault", 5))).toEqual([]);
      expect(check(vault, fact("Mira", "enters", "the library", 5))).toEqual([]);
      expect(check(vault, fact("Mira", "location", "the vault antechamber", 5))).toEqual([]);
    });

    it("applies a rule about the dead only to characters dead at that point", () => {
      const silence = rule("dead", "cannot", "speak", 1);
      const [finding] = check(silence, fact("Harrow", "status", "dead", 3), fact("Harrow", "spoke", "to Mira", 6));
      expect(finding).toMatchObject({ chapter: 6 });
      expect(check(silence, fact("Harrow", "speaks", "to Mira", 2), fact("Harrow", "status", "dead", 3))).toEqual([]);
      expect(check(silence, fact("Harrow", "status", "dead", 3, 4), fact("Harrow", "speaks", "to Mira", 6))).toEqual([]);
    });

    it("reads classes from identity facts", () => {
      const water = rule("vampires", "cannot", "cross running water", 1);
      expect(check(water, fact("Count", "species", "vampire", 1), fact("Count", "crosses", "the running water", 4))).toHaveLength(1);
      expect(check(water, fact("Mira", "species", "human", 1), fact("Mira", "crosses", "the running water", 4))).toEqual([]);
      expect(check(water, fact("Count", "species", "vampire", 1), fact("Count", "crosses", "the bridge", 4))).toEqual([]);
    });

    it("reads Chinese prohibitions", () => {
      expect(check(rule("任何人", "不得", "进入禁地", 1), fact("林远", "进入", "禁地", 4))).toHaveLength(1);
      expect(check(rule("任何人", "不得", "进入禁地", 1), fact("林远", "位置", "禁地", 4))).toHaveLength(1);
      expect(check(rule("任何人", "不得", "进入禁地", 1), fact("林远", "试图进入", "禁地", 4))).toEqual([]);
      const key = rule("没有钥匙的人", "不能", "进入宝库", 1);
      expect(check(key, fact("林远", "进入", "宝库", 4))).toHaveLength(1);
      expect(check(key, fact("林远", "持有", "宝库钥匙", 2), fact("林远", "进入", "宝库", 4))).toEqual([]);
    });

    it("ignores rules it cannot read, unlabelled facts and acts before the rule", () => {
      expect(check(rule("no one", "can enter", "the vault unless invited", 1), fact("Mira", "enters", "the vault", 5))).toEqual([]);
      expect(check(rule("mortals", "cannot", "be harmed by fire", 1), fact("Mira", "is", "harmed by fire", 5))).toEqual([]);
      // A character trait, not a world rule.
      expect(check(fact("Mira", "cannot", "swim", 1), fact("Mira", "swims", "across the lake", 5))).toEqual([]);
      expect(check(rule("no one", "can enter", "the vault", 5), fact("Mira", "enters", "the vault", 3))).toEqual([]);
    });
  });
});
