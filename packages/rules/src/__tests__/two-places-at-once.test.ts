import { describe, expect, it } from "vitest";
import type { CurrentStateFact } from "@actalk/inkos-core";
import { checkDelta, checkSnapshot, twoPlacesAtOnce } from "../index.js";
import { delta, fact, snapshot } from "./fixtures.js";

const check = (facts: CurrentStateFact[]) => checkSnapshot(snapshot(facts), [twoPlacesAtOnce]);

describe("continuity/two-places-at-once", () => {
  it("flags two location facts valid in the same chapter, at the first shared chapter", () => {
    const diagnostics = check([
      fact("Mira", "location", "harbour", 3),
      fact("Mira", "位置", "chapel", 5, 8),
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "continuity/two-places-at-once",
      severity: "warning",
      confidence: "extracted",
      chapter: 5,
    });
    expect(diagnostics[0]!.facts).toHaveLength(2);
    expect(diagnostics[0]!.evidence[0]).toContain("Mira · location · harbour");
    expect(diagnostics[0]!.evidence[1]).toContain("Mira · 位置 · chapel");
  });

  it("does not fire for nested places, the same place spelled differently, or sequential moves", () => {
    expect(check([
      fact("Mira", "location", "harbour", 3),
      fact("Mira", "current_location", "The Harbour Docks", 3),
      fact("Mira", "Current Location", "the harbour", 3),
    ])).toEqual([]);
    expect(check([fact("Mira", "location", "harbour", 1, 4), fact("Mira", "whereabouts", "chapel", 5)])).toEqual([]);
  });

  it("ignores other subjects, vague places and non-location predicates", () => {
    expect(check([
      fact("Mira", "location", "harbour", 1),
      fact("Tomas", "location", "chapel", 1),
      fact("Mira", "whereabouts", "unknown", 1),
      fact("Mira", "所在", "途中", 1),
      fact("Mira", "position", "captain of the guard", 1),
      fact("Mira", "is in", "love", 1),
    ])).toEqual([]);
  });

  it("recognises Chinese location predicates", () => {
    const diagnostics = check([fact("林远", "位置", "城门", 2), fact("林远", "所在地", "药铺", 2)]);
    expect(diagnostics.map((diagnostic) => diagnostic.chapter)).toEqual([2]);
  });

  it("reports a conflict under checkDelta only in the chapter that creates it", () => {
    let state = snapshot([]);
    ({ next: state } = checkDelta(state, delta(1, [["Mira", "location", "harbour"]]), [twoPlacesAtOnce]));
    // Same predicate: the reducer supersedes the old location, so no conflict.
    let result = checkDelta(state, delta(2, [["Mira", "location", "chapel"]]), [twoPlacesAtOnce]);
    expect(result.diagnostics).toEqual([]);
    // A different spelling leaves both valid.
    result = checkDelta(result.next, delta(3, [["Mira", "位置", "market"]]), [twoPlacesAtOnce]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.chapter)).toEqual([3]);
    // The conflict persists but was already reported in chapter 3.
    expect(checkDelta(result.next, delta(4, [["Tomas", "mood", "calm"]]), [twoPlacesAtOnce]).diagnostics).toEqual([]);
  });
});
