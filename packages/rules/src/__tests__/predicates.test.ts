import { describe, expect, it } from "vitest";
import { FactKindSchema, type CurrentStateFact, type FactKind } from "@actalk/inkos-core";
import {
  checkSnapshot, classifyPredicate, deadEntityActs, factKind, hasKind, itemTwoHolders, negativeResource, singleValuedConflict, twoPlacesAtOnce,
} from "../index.js";
import { fact, kinded, snapshot } from "./fixtures.js";

describe("classifyPredicate", () => {
  it.each<[FactKind, string[]]>([
    ["status", ["status", "Life Status", "vital_status", "生死", "存活状态"]],
    ["location", ["location", "Current Location", "whereabouts", "位置", "所在地"]],
    ["age", ["age", "current_age", "年龄", "岁数"]],
    ["possession", ["holds", "held by", "owner", "持有", "所有者"]],
    ["knowledge", ["knows", "is aware of", "believes", "知道", "得知"]],
    ["relationship", ["relationship", "enemy of", "married_to", "师父", "盟友"]],
    ["identity", ["name", "true identity", "occupation", "身份", "门派"]],
    ["trait", ["appearance", "personality", "skill", "性格", "修为"]],
    ["goal", ["goal", "wants to", "mission", "目标", "打算"]],
    ["world_rule", ["rule", "magic rule", "taboo", "法则", "代价"]],
    ["time", ["date", "time of day", "season", "时辰", "季节"]],
    ["resource", ["gold", "spirit stones", "hit points", "剩余灵石", "arrows left"]],
    ["other", ["mood", "is in", "position", "has", "possesses", "在", "处于"]],
  ])("classifies %s predicates", (kind, predicates) => {
    expect(predicates.map(classifyPredicate)).toEqual(predicates.map(() => kind));
  });

  it("has a predicate for every kind", () => {
    const covered = new Set(["status", "location", "age", "holds", "knows", "ally", "alias", "talent", "plan", "law", "date", "mana", "x"]
      .map(classifyPredicate));
    expect([...covered].sort()).toEqual([...FactKindSchema.options].sort());
  });

  it("prefers the earlier vocabulary when a name is in two ('life' is a status, not lives left)", () => {
    expect(classifyPredicate("life")).toBe("status");
  });
});

describe("factKind and hasKind", () => {
  it("takes the settler's label over the predicate name", () => {
    expect(factKind(fact("Mira", "location", "harbour", 1))).toBe("location");
    expect(factKind(kinded("trait", "Mira", "location", "harbour", 1))).toBe("trait");
    expect(factKind(kinded("location", "Mira", "sleeps in", "the barn", 1))).toBe("location");
  });

  it("matches by label or by predicate name, so a label never hides a known predicate", () => {
    expect(hasKind(kinded("location", "Mira", "sleeps in", "the barn", 1), "location")).toBe(true);
    expect(hasKind(kinded("other", "Mira", "location", "harbour", 1), "location")).toBe(true);
    expect(hasKind(fact("Mira", "sleeps in", "the barn", 1), "location")).toBe(false);
    expect(hasKind(fact("Mira", "spirit stones", "5", 1), "resource")).toBe(true);
  });
});

describe("rules over kind-labelled facts", () => {
  const check = (facts: CurrentStateFact[], rule = [twoPlacesAtOnce]) => checkSnapshot(snapshot(facts), rule);

  it("two-places-at-once counts a location label whatever the predicate, and still skips vague places", () => {
    const diagnostics = check([
      fact("Mira", "location", "harbour", 3),
      kinded("location", "Mira", "hiding in", "the chapel crypt", 3),
    ]);
    expect(diagnostics.map((d) => d.chapter)).toEqual([3]);
    // The labelled fact is cited as stored, kind included.
    expect(diagnostics[0]!.facts?.[1]).toMatchObject({ predicate: "hiding in", kind: "location" });
    expect(check([fact("Mira", "location", "harbour", 3), kinded("location", "Mira", "heading", "somewhere between towns", 3)])).toEqual([]);
    // Without the label, "hiding in" is not a location predicate.
    expect(check([fact("Mira", "location", "harbour", 3), fact("Mira", "hiding in", "the chapel crypt", 3)])).toEqual([]);
  });

  it("dead-entity-acts reads death from a status label, and the object still decides dead or alive", () => {
    const diagnostics = check([
      kinded("status", "Mira", "fate", "killed", 2),
      fact("Mira", "location", "harbour", 4),
    ], [deadEntityActs]);
    expect(diagnostics.map((d) => d.chapter)).toEqual([4]);
    expect(check([kinded("status", "Mira", "fate", "wounded", 2), fact("Mira", "location", "harbour", 4)], [deadEntityActs])).toEqual([]);
    // A later status-labelled fact is a status change, not the dead character acting.
    expect(check([kinded("status", "Mira", "fate", "killed", 2), kinded("status", "Mira", "wakefulness", "awake", 4)], [deadEntityActs])).toEqual([]);
  });

  it("single-valued-conflict reads life and age from status and age labels", () => {
    expect(check([kinded("status", "Mira", "fate", "killed", 2), kinded("status", "Mira", "condition now", "still alive", 2)], [singleValuedConflict])
      .map((d) => d.summary)).toEqual(["Mira is recorded as both alive and dead in chapter 2."]);
    expect(check([fact("Mira", "age", "17", 1), kinded("age", "Mira", "years lived", "19 years old", 1)], [singleValuedConflict])
      .map((d) => d.summary)).toEqual(["Mira has two ages in chapter 1: 17 and 19."]);
    // An age label on a value that is not plainly an age is still not read.
    expect(check([fact("Mira", "age", "17", 1), kinded("age", "Mira", "looks", "about twenty", 1)], [singleValuedConflict])).toEqual([]);
  });

  it("negative-resource counts a resource label, keeping the signed-quantity exclusions", () => {
    expect(check([kinded("resource", "Mira", "purse", "-12", 3)], [negativeResource]).map((d) => d.chapter)).toEqual([3]);
    expect(check([kinded("resource", "Mira", "purse change", "-12", 3)], [negativeResource])).toEqual([]);
    expect(check([kinded("resource", "Mira", "debt", "-12", 3)], [negativeResource])).toEqual([]);
    expect(check([fact("Mira", "purse", "-12", 3)], [negativeResource])).toEqual([]);
  });

  it("item-two-holders still needs a directional predicate: a possession label alone does not say who holds what", () => {
    expect(check([
      kinded("possession", "Mira", "has on her", "brass key", 2),
      kinded("possession", "Tomas", "has on him", "brass key", 2),
    ], [itemTwoHolders])).toEqual([]);
    expect(check([
      kinded("possession", "Mira", "holds", "brass key", 2),
      kinded("possession", "brass key", "held by", "Tomas", 2),
    ], [itemTwoHolders]).map((d) => d.chapter)).toEqual([2]);
  });
});
