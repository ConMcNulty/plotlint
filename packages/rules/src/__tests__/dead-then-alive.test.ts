import { describe, expect, it } from "vitest";
import { checkSnapshot, deadThenAlive } from "../index.js";
import { fact, snapshot } from "./fixtures.js";

const check = (...facts: Parameters<typeof snapshot>[0]) => checkSnapshot(snapshot(facts, 12), [deadThenAlive]);

describe("continuity/dead-then-alive", () => {
  it("warns when a recorded death ends and the character is alive again, citing both", () => {
    const diagnostics = check(
      fact("Harrow", "status", "dead", 2, 4),
      fact("Harrow", "status", "alive", 5),
      fact("Harrow", "location", "lantern house", 5),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "continuity/dead-then-alive",
      severity: "warning",
      confidence: "extracted",
      chapter: 5,
      summary: "Harrow is recorded as dead from chapter 2, but is alive in chapter 5.",
    });
    expect(diagnostics[0]!.evidence[0]).toMatch(/^death: Harrow · status · dead/u);
    expect(diagnostics[0]!.evidence[1]).toMatch(/^alive again: Harrow · status · alive/u);
  });

  it("warns when the character acts after the death ends without a new status", () => {
    const [finding] = check(
      fact("Harrow", "is", "dead", 2, 3),
      fact("Harrow", "holds", "brass key", 6),
    );
    expect(finding).toMatchObject({ chapter: 6, summary: "Harrow is recorded as dead from chapter 2, but is active again in chapter 6." });
  });

  it("reports one finding when two facts record the same death", () => {
    expect(check(
      fact("Harrow", "is", "dead", 2, 4),
      fact("Harrow", "died from", "a cut throat", 2, 4),
      fact("Harrow", "status", "alive", 5),
    )).toHaveLength(1);
  });

  it("ignores a death that is re-recorded in other words", () => {
    expect(check(
      fact("Harrow", "status", "dead", 2, 4),
      fact("Harrow", "status", "deceased", 5),
      fact("Harrow", "is", "dead", 5),
    )).toEqual([]);
  });

  it("ignores posthumous facts and statuses that are not a life", () => {
    expect(check(
      fact("Harrow", "status", "dead", 2, 4),
      fact("Harrow", "status", "buried", 5),
      fact("Harrow", "grave", "Calder Reach chapel", 5),
    )).toEqual([]);
  });

  it("ignores a death superseded in the chapter that recorded it", () => {
    // validUntil < validFrom: the settler corrected itself, the death was never in force.
    expect(check(
      fact("Harrow", "status", "dead", 3, 2),
      fact("Harrow", "status", "wounded", 3),
    )).toEqual([]);
  });

  it("ignores a death that is still in force", () => {
    expect(check(
      fact("Harrow", "status", "dead", 2),
      fact("Harrow", "location", "lantern house", 5),
    )).toEqual([]);
  });

  it("reads Chinese deaths", () => {
    expect(check(
      fact("林远", "状态", "死亡", 2, 4),
      fact("林远", "状态", "重伤", 5),
    )).toHaveLength(1);
  });
});
