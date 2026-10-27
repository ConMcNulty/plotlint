import { describe, expect, it } from "vitest";
import { resolveFactEvidence } from "../agents/settler-evidence.js";
import { createSettlementToolSchema } from "../agents/settler-tool.js";
import { applyRuntimeStateDelta, type RuntimeStateSnapshot } from "../state/state-reducer.js";
import { locateQuote } from "../utils/quote-locate.js";

const CHAPTER = [
  "Mira closed the ledger. “We leave at dawn,” she said — and meant it.",
  "",
  "Tomas pocketed the *brass key*. Nobody saw him do it.",
  "",
  "By noon the  harbour was empty, and Mira was gone.",
].join("\n");

const slice = (span: { start: number; end: number } | null) => span && CHAPTER.slice(span.start, span.end);

describe("locateQuote", () => {
  it("finds an exact quote", () => {
    expect(slice(locateQuote(CHAPTER, "Nobody saw him do it."))).toBe("Nobody saw him do it.");
  });

  it("folds straight quotes, hyphen dashes, collapsed whitespace and dropped emphasis back to the original text", () => {
    expect(slice(locateQuote(CHAPTER, "\"We leave at dawn,\" she said - and meant it."))).toBe("We leave at dawn,” she said — and meant it.");
    expect(slice(locateQuote(CHAPTER, "Tomas pocketed the brass key."))).toBe("Tomas pocketed the *brass key*.");
    expect(slice(locateQuote(CHAPTER, "By noon the harbour was empty"))).toBe("By noon the  harbour was empty");
  });

  it("ignores the case of a quote's first letter", () => {
    expect(slice(locateQuote(CHAPTER, "nobody saw him do it"))).toBe("Nobody saw him do it");
  });

  it("matches a quote elided with an ellipsis, in order and within the gap limit", () => {
    expect(slice(locateQuote(CHAPTER, "Mira closed the ledger... she said"))).toBe("Mira closed the ledger. “We leave at dawn,” she said");
    expect(locateQuote(CHAPTER, "she said … Mira closed the ledger")).toBeNull();
    expect(locateQuote(CHAPTER, "Mira closed the ledger … Mira was gone", { maxGap: 10 })).toBeNull();
  });

  it("returns null for a paraphrase and picks the occurrence nearest a hint", () => {
    expect(locateQuote(CHAPTER, "Tomas stole the key")).toBeNull();
    const text = "Mira ran. Later, Mira ran.";
    expect(locateQuote(text, "Mira ran", { near: 15 })).toEqual({ start: 17, end: 25 });
    expect(locateQuote(text, "Mira ran")).toEqual({ start: 0, end: 8 });
  });
});

describe("settler evidence", () => {
  it("offers evidence and fact kinds in the tool schema", () => {
    const schema = createSettlementToolSchema() as unknown as { properties: { factOps: { properties: { upsert: { items: { properties: Record<string, unknown> } } } } } };
    const upsert = schema.properties.factOps.properties.upsert.items;
    expect(Object.keys(upsert.properties)).toEqual(expect.arrayContaining(["kind", "evidence"]));
  });

  it("locates each quote and reports the ones that are not in the chapter", () => {
    const { factOps, unresolved } = resolveFactEvidence({
      upsert: [
        { subject: "Tomas", predicate: "holds", object: "brass key", kind: "possession", evidence: "Tomas pocketed the brass key." },
        { subject: "Mira", predicate: "location", object: "the road", kind: "location", evidence: "Mira set off along the road." },
        { subject: "Mira", predicate: "mood", object: "resolved" },
      ],
      expire: [
        { subject: "Mira", predicate: "location", object: "harbour", evidence: "Mira was gone" },
        { subject: "Tomas", predicate: "mood" },
      ],
    }, CHAPTER);

    expect(factOps.upsert[0]).toEqual({
      subject: "Tomas", predicate: "holds", object: "brass key", kind: "possession",
      evidence: { quote: "Tomas pocketed the *brass key*.", start: CHAPTER.indexOf("Tomas"), end: CHAPTER.indexOf("Tomas") + 31 },
    });
    expect(factOps.upsert[1]?.evidence).toEqual({ quote: "Mira set off along the road." });
    expect(factOps.expire[0]?.evidence?.start).toBe(CHAPTER.indexOf("Mira was gone"));
    expect(factOps.upsert[2]).toEqual({ subject: "Mira", predicate: "mood", object: "resolved" });
    expect(unresolved).toEqual([
      { path: "/factOps/upsert/1/evidence", fact: "Mira · location · the road", quote: "Mira set off along the road." },
      { path: "/factOps/upsert/2/evidence", fact: "Mira · mood · resolved" },
    ]);
  });
});

describe("reducer carries kinds and evidence", () => {
  it("stores evidence on new facts, end evidence on superseded and expired facts, and keeps the first evidence on restatement", () => {
    const ch1 = applyRuntimeStateDelta({
      snapshot: emptySnapshot(),
      delta: delta(1, {
        upsert: [
          { subject: "Mira", predicate: "location", object: "harbour", kind: "location", evidence: { quote: "Mira at the harbour", start: 0, end: 19 } },
          { subject: "Tomas", predicate: "holds", object: "brass key", kind: "possession", evidence: { quote: "Tomas took the key", start: 30, end: 48 } },
        ],
        expire: [],
      }),
    });
    expect(ch1.currentState.facts.find((fact) => fact.subject === "Mira")).toMatchObject({ kind: "location", evidence: { quote: "Mira at the harbour" } });

    const ch2 = applyRuntimeStateDelta({
      snapshot: ch1,
      delta: delta(2, {
        upsert: [
          { subject: "Mira", predicate: "location", object: "road", kind: "location", evidence: { quote: "Mira took the road", start: 5, end: 23 } },
          { subject: "Tomas", predicate: "holds", object: "brass key", evidence: { quote: "the key in his pocket", start: 50, end: 71 } },
        ],
        expire: [],
      }),
    });
    const harbour = ch2.currentState.facts.find((fact) => fact.object === "harbour");
    expect(harbour).toMatchObject({ validUntilChapter: 1, endEvidence: { quote: "Mira took the road" } });
    expect(ch2.currentState.facts.find((fact) => fact.object === "brass key")?.evidence?.quote).toBe("Tomas took the key");

    const ch3 = applyRuntimeStateDelta({
      snapshot: ch2,
      delta: delta(3, { upsert: [], expire: [{ subject: "Tomas", predicate: "holds", evidence: { quote: "He lost the key", start: 0, end: 15 } }] }),
    });
    expect(ch3.currentState.facts.find((fact) => fact.object === "brass key")).toMatchObject({ validUntilChapter: 2, endEvidence: { quote: "He lost the key" } });
  });

  it("leaves facts without kinds or evidence unchanged", () => {
    const next = applyRuntimeStateDelta({
      snapshot: emptySnapshot(),
      delta: delta(1, { upsert: [{ subject: "Lin", predicate: "location", object: "archive" }], expire: [] }),
    });
    expect(next.currentState.facts[0]).toEqual({ subject: "Lin", predicate: "location", object: "archive", validFromChapter: 1, validUntilChapter: null, sourceChapter: 1 });
  });
});

function delta(chapter: number, factOps: Parameters<typeof applyRuntimeStateDelta>[0]["delta"]["factOps"]) {
  return { chapter, factOps, hookOps: { upsert: [], mention: [], resolve: [], defer: [] }, newHookCandidates: [] };
}

function emptySnapshot(): RuntimeStateSnapshot {
  return {
    manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 0, projectionVersion: 1 },
    currentState: { chapter: 0, facts: [] },
    hooks: { hooks: [] },
    chapterSummaries: { rows: [] },
  };
}
