import { describe, expect, it } from "vitest";
import type { CurrentStateFact } from "@actalk/inkos-core";
import {
  builtinRegistry, checkDelta, checkSnapshot, explainCheck, invariantRule, InvariantsFileSchema, matchesFact,
  RuleConfigFileSchema, type Invariant, type InvariantCheck,
} from "../index.js";
import { delta, fact, kinded, snapshot } from "./fixtures.js";

const invariant = (check: InvariantCheck, extra: Partial<Invariant> = {}): Invariant => ({
  id: "test-invariant",
  text: "the author's rule",
  status: "approved",
  check,
  explanation: explainCheck(check),
  ...extra,
});

const run = (invariants: Invariant[], facts: CurrentStateFact[], chapters?: Map<number, string>, last = 30) =>
  checkSnapshot(snapshot(facts, last), {
    rules: [invariantRule],
    book: { invariants: InvariantsFileSchema.parse({ version: 1, invariants }) },
    ...(chapters ? { chapters } : {}),
  });

const learnsIdentity: InvariantCheck = {
  kind: "not-before",
  fact: { subject: { equals: ["Mira", "Mira Vell"] }, kind: "knowledge", object: { contains: ["captain", "voss"] } },
  chapter: 20,
};

describe("invariant fact patterns", () => {
  it("matches exact names with normalize, substrings and regexes case-insensitively, and kinds by label or vocabulary", () => {
    const f = fact("Mira Vell", "learned", "Captain Voss is her father", 3);
    expect(matchesFact({ subject: "mira-vell" }, f)).toBe(true);
    expect(matchesFact({ subject: "Mira" }, f)).toBe(false);
    expect(matchesFact({ object: { contains: ["VOSS"] } }, f)).toBe(true);
    expect(matchesFact({ object: { regex: "^captain\\s+voss" } }, f)).toBe(true);
    expect(matchesFact({ kind: "knowledge" }, f)).toBe(true);
    expect(matchesFact({ kind: ["location", "status"] }, f)).toBe(false);
    expect(matchesFact({ kind: "knowledge" }, kinded("knowledge", "Mira", "figured out", "x", 3))).toBe(true);
    expect(matchesFact({ subject: { contains: ["林"] } }, fact("林远", "状态", "死亡", 2))).toBe(true);
  });

  it("rejects malformed checks", () => {
    const file = (check: unknown) => InvariantsFileSchema.safeParse({ version: 1, invariants: [{ ...invariant(learnsIdentity), check }] }).success;
    expect(file(learnsIdentity)).toBe(true);
    expect(file({ kind: "never", fact: {} })).toBe(false);
    expect(file({ kind: "never", fact: { object: { regex: "(" } } })).toBe(false);
    expect(file({ kind: "not-before", fact: { subject: "Mira" }, chapter: "twenty" })).toBe(false);
    expect(file({ kind: "eval", code: "process.exit()" })).toBe(false);
    expect(InvariantsFileSchema.safeParse({ version: 1, invariants: [invariant(learnsIdentity), invariant(learnsIdentity)] }).success).toBe(false);
    expect(InvariantsFileSchema.safeParse({ version: 1, invariants: [{ ...invariant(learnsIdentity), id: "Not Kebab" }] }).success).toBe(false);
  });
});

describe("continuity/invariant", () => {
  it("is registered", () => {
    expect(builtinRegistry.get("continuity/invariant")).toBe(invariantRule);
  });

  describe("not-before", () => {
    it("fails when a matching fact is in force before the chapter, quoting the author's text and citing the fact", () => {
      const [finding, ...rest] = run([invariant(learnsIdentity, { id: "mira-captain-identity", text: "Mira must not learn the captain's identity before chapter 20" })], [
        fact("Mira", "knows", "Captain Voss is her father", 12),
        fact("Mira", "location", "harbour", 12),
      ]);
      expect(rest).toEqual([]);
      expect(finding).toMatchObject({
        code: "mira-captain-identity",
        ruleId: "continuity/invariant",
        severity: "error",
        confidence: "extracted",
        chapter: 12,
        summary: "Invariant \"Mira must not learn the captain's identity before chapter 20\" fails in chapter 12: Mira · knows · Captain Voss is her father.",
      });
      expect(finding!.evidence[0]).toMatch(/^fact: Mira · knows · Captain Voss is her father \(from ch12/u);
      expect(finding!.facts).toHaveLength(1);
    });

    it("passes when the fact comes in force at or after the chapter, or was never in force", () => {
      expect(run([invariant(learnsIdentity)], [
        fact("Mira", "knows", "Captain Voss is her father", 20),
        fact("Mira", "knows", "the captain's name", 8, 7), // superseded in the chapter that added it
        fact("Tomas", "knows", "Captain Voss is her father", 3),
      ])).toEqual([]);
    });

    it("groups facts by chapter", () => {
      const findings = run([invariant(learnsIdentity)], [
        fact("Mira", "knows", "Captain Voss is her father", 12),
        fact("Mira Vell", "discovered", "the captain's real name", 12),
        fact("Mira", "suspects", "Voss", 15),
      ]);
      expect(findings.map((d) => [d.chapter, d.facts?.length])).toEqual([[12, 2], [15, 1]]);
      expect(findings[0]!.summary).toContain("and 1 more");
    });

    it("counts a fact that started before the chapter even if it is still in force", () => {
      expect(run([invariant({ ...learnsIdentity, chapter: 10 })], [fact("Mira", "knows", "Voss", 4)]).map((d) => d.chapter)).toEqual([4]);
    });
  });

  describe("not-after", () => {
    const check: InvariantCheck = { kind: "not-after", fact: { subject: "Harrow", kind: "location" }, chapter: 10 };
    it("fails when a matching fact is in force after the chapter, at the first chapter past it", () => {
      expect(run([invariant(check)], [fact("Harrow", "location", "the capital", 8)]).map((d) => d.chapter)).toEqual([11]);
      expect(run([invariant(check)], [fact("Harrow", "location", "the capital", 14)]).map((d) => d.chapter)).toEqual([14]);
    });
    it("passes when the fact ends by the chapter", () => {
      expect(run([invariant(check)], [fact("Harrow", "location", "the capital", 8, 10)])).toEqual([]);
    });
  });

  describe("never", () => {
    const holds: InvariantCheck = { kind: "never", fact: { subject: "Tomas", kind: "possession", object: { contains: ["sword"] } } };
    it("fails on any matching fact", () => {
      expect(run([invariant(holds)], [fact("Tomas", "holds", "the old sword", 3)]).map((d) => d.chapter)).toEqual([3]);
    });
    it("passes on facts that do not match", () => {
      expect(run([invariant(holds)], [fact("Tomas", "holds", "a lantern", 3), fact("Mira", "holds", "the old sword", 3)])).toEqual([]);
    });
    it("limits itself to from..until", () => {
      const ranged: InvariantCheck = { ...holds, from: 5, until: 8 };
      expect(run([invariant(ranged)], [fact("Tomas", "holds", "sword", 2, 4), fact("Tomas", "carries", "sword", 9)])).toEqual([]);
      expect(run([invariant(ranged)], [fact("Tomas", "holds", "sword", 2)]).map((d) => d.chapter)).toEqual([5]);
      expect(run([invariant({ ...holds, from: "last" })], [fact("Tomas", "holds", "sword", 2, 29)], undefined, 30)).toEqual([]);
      expect(run([invariant({ ...holds, from: "last" })], [fact("Tomas", "holds", "sword", 2)], undefined, 30).map((d) => d.chapter)).toEqual([30]);
    });
  });

  describe("requires-before", () => {
    const check: InvariantCheck = {
      kind: "requires-before",
      fact: { predicate: { contains: ["open"] }, object: { contains: ["vault"] } },
      requires: { kind: "possession", object: { contains: ["key"] } },
      sameSubject: true,
    };
    it("fails when the fact has no earlier prerequisite", () => {
      const [finding] = run([invariant(check)], [fact("Mira", "opened", "the vault", 6), fact("Mira", "holds", "brass key", 9)]);
      expect(finding).toMatchObject({ chapter: 6, summary: expect.stringContaining("Mira · opened · the vault, with nothing earlier that it requires") });
      expect(finding!.evidence[0]).toMatch(/^without its prerequisite: Mira · opened/u);
    });
    it("passes with an earlier or same-chapter prerequisite", () => {
      expect(run([invariant(check)], [fact("Mira", "holds", "brass key", 4, 5), fact("Mira", "opened", "the vault", 6)])).toEqual([]);
      expect(run([invariant(check)], [fact("Mira", "holds", "brass key", 6), fact("Mira", "opened", "the vault", 6)])).toEqual([]);
    });
    it("needs an earlier chapter when strict, and the same subject when sameSubject", () => {
      expect(run([invariant({ ...check, strict: true })], [fact("Mira", "holds", "brass key", 6), fact("Mira", "opened", "the vault", 6)])).toHaveLength(1);
      expect(run([invariant(check)], [fact("Tomas", "holds", "brass key", 2), fact("Mira", "opened", "the vault", 6)])).toHaveLength(1);
      expect(run([invariant({ ...check, sameSubject: false })], [fact("Tomas", "holds", "brass key", 2), fact("Mira", "opened", "the vault", 6)])).toEqual([]);
    });
  });

  describe("text-not-before", () => {
    const check: InvariantCheck = { kind: "text-not-before", text: { contains: ["inside the vault", "金库里"] }, chapter: "last" };
    const chapters = new Map([
      [1, "# Chapter 1\n\nThe vault door stayed shut."],
      [4, "# Chapter 4\n\nShe stood inside the vault. Inside the Vault again, later."],
      [10, "# Chapter 10\n\nAt last, inside the vault, gold."],
    ]);
    it("fails on the first mention per chapter before the finale, with a range into the chapter file", () => {
      const findings = run([invariant(check, { id: "vault-reveal", text: "the reader never sees inside the vault until the finale" })], [], chapters, 10);
      expect(findings).toHaveLength(1);
      const start = chapters.get(4)!.indexOf("inside the vault");
      expect(findings[0]).toMatchObject({
        code: "vault-reveal",
        confidence: "deterministic",
        chapter: 4,
        range: { sourceId: "chapter:4", start, end: start + "inside the vault".length },
        sourceRefs: [{ sourceId: "chapter:4", quote: "inside the vault" }],
        summary: "Invariant \"the reader never sees inside the vault until the finale\" fails in chapter 4: the text says \"inside the vault\" (2 times).",
      });
      expect(findings[0]!.evidence[0]).toContain("She stood inside the vault.");
    });
    it("reads Chinese phrases and regexes, and a numbered chapter", () => {
      const zh = new Map([[2, "他走进金库里，看见黄金。"]]);
      expect(run([invariant(check)], [], zh, 5).map((d) => d.chapter)).toEqual([2]);
      const regex: InvariantCheck = { kind: "text-not-before", text: { regex: "\\bdragons?\\b" }, chapter: 4 };
      expect(run([invariant(regex)], [], new Map([[1, "No dragonfly here."], [3, "A Dragon!"], [4, "dragons"]])).map((d) => d.chapter)).toEqual([3]);
    });
    it("passes without chapter text", () => {
      expect(run([invariant(check)], [], undefined, 10)).toEqual([]);
    });
  });

  it("skips proposed and unsupported invariants", () => {
    const facts = [fact("Mira", "knows", "Voss", 3)];
    expect(run([invariant(learnsIdentity, { status: "proposed" })], facts)).toEqual([]);
    expect(run([invariant({ kind: "unsupported", reason: "honesty is a judgment" })], facts)).toEqual([]);
  });

  it("takes the invariant's severity, and the book's rules.json over it", () => {
    const facts = [fact("Mira", "knows", "Voss", 3)];
    expect(run([invariant(learnsIdentity, { severity: "warning" })], facts)[0]!.severity).toBe("warning");
    const config = RuleConfigFileSchema.parse({ version: 1, rules: { "continuity/invariant": "note" } });
    const book = { config, invariants: InvariantsFileSchema.parse({ version: 1, invariants: [invariant(learnsIdentity)] }) };
    expect(checkSnapshot(snapshot(facts, 5), { book })[0]!.severity).toBe("note");
  });

  it("checks a delta in its chapter", () => {
    const book = { invariants: InvariantsFileSchema.parse({ version: 1, invariants: [invariant(learnsIdentity)] }) };
    const { diagnostics } = checkDelta(snapshot([], 4), delta(5, [["Mira", "knows", "Captain Voss is her father"]]), { rules: [invariantRule], book });
    expect(diagnostics.map((d) => [d.code, d.chapter])).toEqual([["test-invariant", 5]]);
  });

  it("explains each check in plain words", () => {
    expect(explainCheck(learnsIdentity)).toBe(
      "Fails when a fact whose subject is any of \"Mira\", \"Mira Vell\", of kind knowledge and whose object contains any of \"captain\", \"voss\" is in force before chapter 20.");
    expect(explainCheck({ kind: "text-not-before", text: { contains: ["inside the vault"] }, chapter: "last" })).toBe(
      "Fails when the phrase \"inside the vault\" appears in the chapter text before the last chapter (case-insensitive).");
    expect(explainCheck({ kind: "never", fact: { subject: "Tomas" }, from: 3 })).toBe("Fails when a fact whose subject is \"Tomas\" is in force from chapter 3 on.");
    expect(explainCheck({ kind: "unsupported", reason: "Lying is a judgment." })).toBe("Not checked: Lying is a judgment.");
  });
});
