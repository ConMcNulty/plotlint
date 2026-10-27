import { describe, expect, it } from "vitest";
import type { CurrentStateFact, FactEvidence } from "@actalk/inkos-core";
import { endedAt, establishedAt, evidenceCoverage, findDefinitions, locateEvidence, stateAt, type ChapterTexts } from "../index.js";
import { fact, kinded, snapshot } from "./fixtures.js";

// Chapter files as InkOS saves them: a heading, a blank line, then the body.
const CH1 = [
  "# Chapter 1: Harbour",
  "",
  "Mira reached the harbour at dusk.",
  "",
  "She took the brass key from the drawer.",
  "",
  "* * *",
  "",
  "Tomas waited at the chapel.",
  "",
].join("\n");
const CH2 = [
  "# Chapter 2: Chapel",
  "",
  "Mira left the harbour for the chapel.",
  "",
  "The key slipped from her hand into the sea.",
  "",
  "The chapel roof had fallen in long ago.",
  "",
].join("\n");

const chapters: ChapterTexts = new Map([[1, CH1], [2, CH2]]);

/** Evidence as the settler records it: the quote, at its offset in the body (the file without its heading). */
function cite(text: string, quote: string): FactEvidence {
  const body = text.slice(text.indexOf("\n\n") + 2);
  const start = body.indexOf(quote);
  if (start === -1) throw new Error(`fixture quote not in body: ${quote}`);
  return { quote, start, end: start + quote.length };
}

const at = (text: string, quote: string) => text.indexOf(quote);

const established = (base: CurrentStateFact, evidence: FactEvidence | undefined, endEvidence?: FactEvidence): CurrentStateFact => ({
  ...base,
  ...(evidence ? { evidence } : {}),
  ...(endEvidence ? { endEvidence } : {}),
});

const atHarbour = established(
  kinded("location", "Mira", "location", "harbour", 1, 1),
  cite(CH1, "Mira reached the harbour"),
  cite(CH2, "Mira left the harbour"),
);
const atChapel = established(kinded("location", "Mira", "location", "chapel", 2), cite(CH2, "Mira left the harbour for the chapel"));
const holdsKey = established(fact("Mira", "holds", "brass key", 1, 1), cite(CH1, "She took the brass key"), cite(CH2, "The key slipped"));
const tomasAtChapel = established(fact("Tomas", "location", "the chapel", 1), cite(CH1, "Tomas waited at the chapel"));
const tomasCalm = fact("Tomas", "mood", "calm", 1); // settled before evidence spans existed
const chapelRuined = established(fact("Chapel", "condition", "ruined", 2), cite(CH2, "The chapel roof had fallen in"));
const learnedTruth = established(fact("Mira", "knows", "the truth", 2), { quote: "Mira learned the truth at last." });
const laterFact = established(fact("Mira", "location", "the hills", 3), { quote: "Mira climbed into the hills." });

const facts = [atHarbour, atChapel, holdsKey, tomasAtChapel, tomasCalm, chapelRuined, learnedTruth, laterFact];

describe("locateEvidence", () => {
  it("locates the quote in today's text, with its scene", () => {
    expect(establishedAt(atHarbour, chapters)).toEqual({
      status: "valid",
      location: {
        chapter: 1,
        start: at(CH1, "Mira reached"),
        end: at(CH1, "Mira reached") + "Mira reached the harbour".length,
        quote: "Mira reached the harbour",
        scene: "ch1.s1",
      },
    });
    expect(establishedAt(tomasAtChapel, chapters).location?.scene).toBe("ch1.s2");
    expect(endedAt(holdsKey, chapters)?.location).toMatchObject({ chapter: 2, start: at(CH2, "The key slipped"), scene: "ch2.s1" });
    expect(endedAt(atChapel, chapters)).toBeNull();
  });

  it("reports the quote as the chapter reads today when the settler's quote was folded", () => {
    const text = "# Chapter 1: Lamp\n\nShe lit Mira’s lamp — slowly.\n";
    const located = locateEvidence({ quote: "Mira's lamp - slowly" }, 1, new Map([[1, text]]));
    expect(located.location?.quote).toBe("Mira’s lamp — slowly");
  });

  it("tells uncited, not-found and no-chapter apart", () => {
    expect(establishedAt(tomasCalm, chapters)).toEqual({ status: "uncited" });
    expect(establishedAt(learnedTruth, chapters)).toEqual({ status: "not-found" });
    expect(establishedAt(laterFact, chapters)).toEqual({ status: "no-chapter" });
  });

  it("picks the occurrence the settler meant when a passage repeats, allowing for the heading before the body", () => {
    const text = "# Chapter 5: The Long Road Out Of Town\n\nShe ran. She ran.\n";
    const second = text.lastIndexOf("She ran.");
    // Offset 9 in the body is the second "She ran."; offset 9 in the file is inside the heading.
    expect(locateEvidence({ quote: "She ran.", start: 9, end: 17 }, 5, new Map([[5, text]])).location?.start).toBe(second);
    expect(locateEvidence({ quote: "She ran.", start: 0, end: 8 }, 5, new Map([[5, text]])).location?.start).toBe(text.indexOf("She ran."));
  });

  it("re-segments scenes when a chapter's text changes in place", () => {
    const texts = new Map([[1, "Mira waited.\n\nTomas came.\n"]]);
    expect(locateEvidence({ quote: "Tomas came." }, 1, texts).location?.scene).toBe("ch1.s1");
    texts.set(1, "Mira waited.\n\n* * *\n\nTomas came.\n");
    expect(locateEvidence({ quote: "Tomas came." }, 1, texts).location?.scene).toBe("ch1.s2");
  });
});

describe("evidenceCoverage", () => {
  it("counts one upsert per fact and one expiry per ended fact, by chapter and status", () => {
    const coverage = evidenceCoverage(snapshot(facts, 3), chapters);
    // 8 upserts + 2 expiries (atHarbour, holdsKey), both in chapter 2.
    expect(coverage).toMatchObject({
      total: 10,
      valid: 7,
      ratio: 0.7,
      byStatus: { valid: 7, "not-found": 1, uncited: 1, "no-chapter": 1 },
      byChapter: [
        { chapter: 1, total: 4, valid: 3 },
        { chapter: 2, total: 5, valid: 4 },
        { chapter: 3, total: 1, valid: 0 },
      ],
    });
    expect(coverage.issues.map((issue) => [issue.op, issue.status, issue.chapter, issue.fact.predicate])).toEqual([
      ["upsert", "uncited", 1, "mood"],
      ["upsert", "not-found", 2, "knows"],
      ["upsert", "no-chapter", 3, "location"],
    ]);
  });

  it("checks expiries in the chapter after the fact's last valid chapter", () => {
    const lostKey = established(fact("Mira", "holds", "lamp", 1, 1), cite(CH1, "Mira reached"), { quote: "The lamp went out." });
    const quietEnd = established(fact("Tomas", "mood", "calm", 1, 1), cite(CH1, "Tomas waited"));
    const coverage = evidenceCoverage(snapshot([lostKey, quietEnd]), chapters);
    expect(coverage.issues.map((issue) => [issue.op, issue.status, issue.chapter])).toEqual([
      ["expire", "not-found", 2],
      ["expire", "uncited", 2],
    ]);
    expect(coverage).toMatchObject({ total: 4, valid: 2, ratio: 0.5 });
  });

  it("is 1 with no fact ops", () => {
    expect(evidenceCoverage(snapshot([]), chapters)).toMatchObject({ total: 0, valid: 0, ratio: 1, byChapter: [], issues: [] });
  });
});

describe("stateAt", () => {
  const state = (chapter: number, offset: number) =>
    Object.fromEntries(stateAt(snapshot(facts, 3), { chapter, offset }, chapters)
      .map((entity) => [entity.subject, entity.facts.map((entry) => `${entry.fact.predicate}:${entry.fact.object}${entry.unanchored ? "?" : ""}`)]));

  it("holds a same-chapter fact once the cursor reaches the start of its passage", () => {
    const harbour = at(CH1, "Mira reached");
    expect(state(1, harbour - 1)).toEqual({ Tomas: ["mood:calm?"] });
    expect(state(1, harbour)).toEqual({ Mira: ["location:harbour"], Tomas: ["mood:calm?"] });
    expect(state(1, CH1.length)).toEqual({
      Mira: ["location:harbour", "holds:brass key"],
      Tomas: ["location:the chapel", "mood:calm?"],
    });
  });

  it("flags a same-chapter fact whose passage cannot be located, rather than dropping it", () => {
    const entries = stateAt(snapshot(facts, 3), { chapter: 2, offset: 0 }, chapters).flatMap((entity) => entity.facts);
    expect(entries.find((entry) => entry.fact === learnedTruth)).toMatchObject({ unanchored: true, kind: "knowledge" });
    // Facts from earlier chapters are not flagged, located or not.
    expect(entries.find((entry) => entry.fact === tomasCalm)?.unanchored).toBeUndefined();
    expect(entries.find((entry) => entry.fact === tomasAtChapel)?.established?.chapter).toBe(1);
  });

  it("holds an earlier-chapter fact until the passage that ends it", () => {
    const leaves = at(CH2, "Mira left");
    const slips = at(CH2, "The key slipped");
    // Sorted by kind: knowledge, location, possession.
    expect(state(2, leaves - 1).Mira).toEqual(["knows:the truth?", "location:harbour", "holds:brass key"]);
    // The passage that ends the harbour also starts the chapel.
    expect(state(2, leaves).Mira).toEqual(["knows:the truth?", "location:chapel", "holds:brass key"]);
    expect(state(2, slips).Mira).toEqual(["knows:the truth?", "location:chapel"]);
    expect(state(2, slips).Chapel).toBeUndefined();
    expect(state(2, at(CH2, "The chapel roof")).Chapel).toEqual(["condition:ruined"]);
  });

  it("drops facts ended in an earlier chapter, and ended ones whose end passage cannot be located", () => {
    // Chapter 3 has no text, so its own fact holds but is flagged.
    expect(state(3, 0).Mira).toEqual(["knows:the truth", "location:chapel", "location:the hills?"]);
    const lostEnd = established(fact("Mira", "holds", "lamp", 1, 1), cite(CH1, "Mira reached"), { quote: "The lamp went out." });
    expect(stateAt(snapshot([lostEnd]), { chapter: 2, offset: 0 }, chapters)).toEqual([]);
    expect(stateAt(snapshot([lostEnd]), { chapter: 1, offset: CH1.length }, chapters)).toHaveLength(1);
  });

  it("holds a fact superseded in its own chapter only between its passage and the one that ends it", () => {
    const brief = established(fact("Mira", "mood", "hopeful", 2, 1), cite(CH2, "Mira left"), cite(CH2, "The key slipped"));
    const holds = (offset: number) => stateAt(snapshot([brief]), { chapter: 2, offset }, chapters).length > 0;
    expect([holds(at(CH2, "Mira left") - 1), holds(at(CH2, "Mira left")), holds(at(CH2, "The key slipped"))]).toEqual([false, true, false]);
  });

  it("groups by subject as the rules compare them, sorted by subject then kind", () => {
    const entities = stateAt(snapshot([
      fact("Mira", "mood", "calm", 1),
      kinded("location", "mira ", "hiding in", "the barn", 1),
      fact("Ann", "age", "40", 1),
    ]), { chapter: 2, offset: 0 }, chapters);
    expect(entities.map((entity) => [entity.subject, entity.facts.map((entry) => entry.kind)])).toEqual([
      ["Ann", ["age"]],
      ["Mira", ["location", "other"]],
    ]);
  });
});

describe("findDefinitions", () => {
  const definitions = (name: string) =>
    findDefinitions(snapshot(facts, 3), name, chapters).map((d) => [d.role, d.entity, d.fact.predicate, d.location.chapter, d.location.scene]);

  it("lists a subject's located facts in reading order, skipping ones without a located passage", () => {
    expect(definitions("Mira")).toEqual([
      ["subject", "Mira", "location", 1, "ch1.s1"],
      ["subject", "Mira", "holds", 1, "ch1.s1"],
      ["subject", "Mira", "location", 2, "ch2.s1"],
    ]);
  });

  it("puts facts about the name before facts that only mention it, and matches loosely", () => {
    expect(definitions("the chapel")).toEqual([
      ["subject", "Chapel", "condition", 2, "ch2.s1"],
      ["object", "the chapel", "location", 1, "ch1.s2"],
      ["object", "chapel", "location", 2, "ch2.s1"],
    ]);
    expect(definitions("Brass Key").map((d) => d.slice(0, 2))).toEqual([["object", "brass key"]]);
  });

  it("is empty for an unknown or blank name, or when nothing about it is located", () => {
    expect(definitions("Ildra")).toEqual([]);
    expect(definitions("  ")).toEqual([]);
    expect(definitions("the hills")).toEqual([]);
  });
});
