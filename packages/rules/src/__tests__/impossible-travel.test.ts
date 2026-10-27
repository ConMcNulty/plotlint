import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CurrentStateFact } from "@actalk/inkos-core";
import { checkDelta, checkSnapshot, impossibleTravel, TravelFileSchema, TravelGraph, type BookRuleData } from "../index.js";
import { loadBookRuleData } from "../node.js";
import { delta, fact, snapshot } from "./fixtures.js";

const travel = TravelFileSchema.parse({
  version: 1,
  unit: "hours",
  places: { "the capital": { aliases: ["Varn", "王都"] }, "Calder Reach": {} },
  routes: [
    { from: "Calder Reach", to: "the capital", time: 72 },
    { from: "the capital", to: "Saltmere", time: 24 },
    { from: "Calder Reach", to: "lantern house", time: 1 },
    { from: "Saltmere", to: "the Isle", time: 12, bidirectional: false },
  ],
});
const book: BookRuleData = { travel };

const check = (facts: CurrentStateFact[], options: { book?: BookRuleData; config?: Record<string, unknown> } = {}) =>
  checkSnapshot(snapshot(facts, 12), {
    rules: [impossibleTravel],
    book: { ...(options.book ?? book), ...(options.config ? { config: { version: 1, rules: { "continuity/impossible-travel": { options: options.config } } } } : {}) },
  });

describe("TravelGraph", () => {
  const graph = new TravelGraph(travel);

  it("resolves names, aliases and places nested in a name", () => {
    expect(graph.resolve("The Capital")).toBe("capital");
    expect(graph.resolve("Varn")).toBe("capital");
    expect(graph.resolve("王都")).toBe("capital");
    expect(graph.resolve("the capital's south gate")).toBe("capital");
    expect(graph.resolve("Calder Reach harbour")).toBe("calderreach");
    expect(graph.resolve("the moon")).toBeNull();
  });

  it("finds the shortest path, both ways unless a route is one-way", () => {
    expect(graph.hours("calderreach", "saltmere")).toBe(96);
    expect(graph.hours("saltmere", "calderreach")).toBe(96);
    expect(graph.hours("saltmere", "isle")).toBe(12);
    expect(graph.hours("isle", "saltmere")).toBe(Infinity);
    expect(graph.hours("capital", "capital")).toBe(0);
  });

  it("reads units", () => {
    const days = new TravelGraph(TravelFileSchema.parse({ version: 1, unit: "days", routes: [{ from: "a", to: "b", time: 2 }] }));
    expect(days.hours("a", "b")).toBe(48);
  });
});

describe("continuity/impossible-travel", () => {
  it("flags a move between chapters faster than the route allows, citing the locations and the time", () => {
    const diagnostics = check([
      fact("Mira", "location", "Calder Reach", 3, 3),
      fact("Mira", "location", "the capital", 4),
      fact("story", "time", "the next morning", 4),
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "continuity/impossible-travel",
      severity: "warning",
      confidence: "extracted",
      chapter: 4,
      summary: "Mira gets from Calder Reach (ch3) to the capital (ch4) in at most 2 days of story time, but the fastest route from Calder Reach to the capital in travel.json takes 3 days.",
    });
    expect(diagnostics[0]!.evidence.map((line) => line.split(":")[0])).toEqual(["from", "to", "time"]);
    expect(diagnostics[0]!.facts).toHaveLength(3);
  });

  it("uses dates when both chapters have one", () => {
    const facts = [
      fact("Mira", "location", "Calder Reach", 3, 4),
      fact("story", "date", "12 March 1891", 3),
      fact("Mira", "位置", "Saltmere", 5),
      fact("story", "date", "14 March 1891", 5),
    ];
    // 12 March to the end of 14 March is 3 days; Calder Reach to Saltmere is 4.
    expect(check(facts).map((d) => d.chapter)).toEqual([5]);
    expect(check(facts.map((f) => (f.object === "14 March 1891" ? { ...f, object: "16 March 1891" } : f)))).toEqual([]);
  });

  it("allows the move when enough time is marked, however it is spelled", () => {
    expect(check([
      fact("Mira", "location", "Calder Reach", 3, 3),
      fact("Mira", "location", "the capital", 4),
      fact("story", "time", "three days later", 4),
    ])).toEqual([]);
    expect(check([
      fact("Mira", "location", "Calder Reach", 3, 3),
      fact("Mira", "location", "Varn", 4),
      fact("story", "elapsed time", "a week", 4),
    ])).toEqual([]);
    expect(check([
      fact("林远", "位置", "Calder Reach", 3, 3),
      fact("林远", "位置", "王都", 4),
      fact("时间", "时间", "五天后", 4),
    ])).toEqual([]);
  });

  it("does not judge a move when the elapsed time is unknown", () => {
    // No marker at all.
    expect(check([fact("Mira", "location", "Calder Reach", 3, 3), fact("Mira", "location", "the capital", 4)])).toEqual([]);
    // A chapter in between says nothing about time.
    expect(check([
      fact("Mira", "location", "Calder Reach", 3, 5),
      fact("Mira", "location", "the capital", 6),
      fact("story", "time", "the next morning", 6),
    ])).toEqual([]);
    // Vague: "days later" has no ceiling.
    expect(check([
      fact("Mira", "location", "Calder Reach", 3, 3),
      fact("Mira", "location", "the capital", 4),
      fact("story", "time", "days later", 4),
    ])).toEqual([]);
    // The chapter looks back, so its facts may be set in the past.
    expect(check([
      fact("Mira", "location", "Calder Reach", 3, 3),
      fact("Mira", "location", "the capital", 4),
      fact("story", "time", "the next morning", 4),
      fact("story", "time", "twenty years ago", 4),
    ])).toEqual([]);
  });

  it("ignores places the graph does not know, journeys, nested places and quick routes", () => {
    const marker = fact("story", "time", "an hour later", 4);
    expect(check([fact("Mira", "location", "Calder Reach", 3, 3), fact("Mira", "location", "the moon", 4), marker])).toEqual([]);
    expect(check([fact("Mira", "location", "Calder Reach", 3, 3), fact("Mira", "location", "on the road to the capital", 4), marker])).toEqual([]);
    expect(check([fact("Mira", "location", "the capital", 3, 3), fact("Mira", "location", "the capital's south gate", 4), marker])).toEqual([]);
    expect(check([fact("Mira", "location", "Calder Reach", 3, 3), fact("Mira", "location", "lantern house", 4), fact("story", "time", "two hours later", 4)])).toEqual([]);
    // No route joins them: unknown, not impossible.
    expect(check([fact("Mira", "location", "the Isle", 3, 3), fact("Mira", "location", "Saltmere", 4), marker])).toEqual([]);
  });

  it("chains through an unknown place instead of skipping it", () => {
    // Calder Reach → the moon → the capital: the moon breaks the chain, so neither pair is judged.
    expect(check([
      fact("Mira", "location", "Calder Reach", 3, 3),
      fact("Mira", "location", "the moon", 4, 4),
      fact("Mira", "location", "the capital", 5),
      fact("story", "time", "an hour later", 4),
      fact("story", "time", "an hour later", 5),
    ])).toEqual([]);
  });

  it("leaves two places valid at once to two-places-at-once", () => {
    expect(check([
      fact("Mira", "location", "Calder Reach", 3),
      fact("Mira", "位置", "the capital", 4),
      fact("story", "time", "an hour later", 4),
    ])).toEqual([]);
  });

  it("judges a move within one chapter from that chapter's markers", () => {
    expect(check([
      fact("Mira", "location", "Calder Reach", 5, 4),
      fact("Mira", "location", "the capital", 5),
      fact("story", "time", "later that night", 5),
    ]).map((d) => d.chapter)).toEqual([5]);
  });

  it("flags an unmarked move within one chapter only when sameChapterHours is set", () => {
    const facts = [fact("Mira", "location", "Calder Reach", 5, 4), fact("Mira", "location", "the capital", 5)];
    expect(check(facts)).toEqual([]);
    const [finding] = check(facts, { config: { sameChapterHours: 24 } });
    expect(finding?.summary).toBe("Mira gets from Calder Reach to the capital within chapter 5, with no time marked, but the fastest route from Calder Reach to the capital in travel.json takes 3 days.");
    expect(check(facts, { config: { sameChapterHours: 96 } })).toEqual([]);
  });

  it("emits nothing without a travel.json", () => {
    const facts = [fact("Mira", "location", "Calder Reach", 3, 3), fact("Mira", "location", "the capital", 4), fact("story", "time", "an hour later", 4)];
    expect(checkSnapshot(snapshot(facts, 12), [impossibleTravel])).toEqual([]);
    expect(check(facts, { book: {} })).toEqual([]);
  });

  it("reports under checkDelta in the chapter of the arrival", () => {
    let state = snapshot([]);
    ({ next: state } = checkDelta(state, delta(3, [["Mira", "location", "Calder Reach"]]), { rules: [impossibleTravel], book }));
    const result = checkDelta(state, delta(4, [["Mira", "location", "the capital"], ["story", "time", "an hour later"]]), { rules: [impossibleTravel], book });
    expect(result.diagnostics.map((d) => d.chapter)).toEqual([4]);
  });

  it("loads travel.json from the book's plotlint folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plotlint-travel-"));
    try {
      await mkdir(join(dir, "story", "plotlint"), { recursive: true });
      await writeFile(join(dir, "story", "plotlint", "travel.json"), JSON.stringify({ version: 1, routes: [{ from: "a", to: "b", time: 3 }] }));
      const data = await loadBookRuleData(dir);
      expect(data.travel).toEqual({ version: 1, unit: "hours", places: {}, routes: [{ from: "a", to: "b", time: 3, bidirectional: true }] });
      await writeFile(join(dir, "story", "plotlint", "travel.json"), JSON.stringify({ version: 1, routes: [{ from: "a", to: "b", hours: 3 }] }));
      await expect(loadBookRuleData(dir)).rejects.toThrow(/travel\.json/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
