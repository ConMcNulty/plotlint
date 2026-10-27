import { describe, expect, it } from "vitest";
import {
  SuppressionFileSchema,
  SuppressionSchema,
  applySuppressions,
  diagnosticFingerprint,
  type Diagnostic,
  type Suppression,
} from "../index.js";

const base: Diagnostic = {
  code: "dead-entity-acts",
  ruleId: "continuity/dead-entity-acts",
  layer: "continuity",
  severity: "warning",
  confidence: "extracted",
  summary: "Mira acts after her death.",
  evidence: ["death: Mira · status · dead"],
  chapter: 7,
};

const createdAt = "2026-10-27T00:00:00.000Z";

describe("SuppressionSchema", () => {
  it("accepts rule and instance suppressions", () => {
    const rule: Suppression = { kind: "rule", ruleId: base.ruleId, reason: "ghost story", createdAt };
    const instance: Suppression = {
      kind: "instance", ruleId: base.ruleId, fingerprint: "0123456789abcdef", reason: "flashback",
      createdAt, author: "cob", chapter: 7, quote: "Mira acts after her death.",
    };
    expect(SuppressionSchema.parse(rule)).toEqual(rule);
    expect(SuppressionSchema.parse(instance)).toEqual(instance);
  });

  it("rejects a suppression without a reason or an instance without a fingerprint", () => {
    expect(() => SuppressionSchema.parse({ kind: "rule", ruleId: base.ruleId, reason: "", createdAt })).toThrow();
    expect(() => SuppressionSchema.parse({ kind: "instance", ruleId: base.ruleId, reason: "x", createdAt })).toThrow();
  });

  it("parses a versioned suppressions file", () => {
    expect(SuppressionFileSchema.parse({ version: 1, suppressions: [] })).toEqual({ version: 1, suppressions: [] });
    expect(() => SuppressionFileSchema.parse({ version: 2, suppressions: [] })).toThrow();
  });
});

describe("diagnosticFingerprint", () => {
  it("is a 16-digit hex hash that ignores offsets, the summary's wording and whitespace", () => {
    const fingerprint = diagnosticFingerprint(base);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/u);
    expect(diagnosticFingerprint({ ...base, range: { sourceId: "chapter:7", start: 900, end: 920 } })).toBe(fingerprint);
    expect(diagnosticFingerprint({ ...base, summary: "Reworded." })).toBe(fingerprint);
    expect(diagnosticFingerprint({ ...base, evidence: ["  death:  Mira · status ·\ndead "] })).toBe(fingerprint);
  });

  it("is pinned, so saved suppressions keep matching across releases", () => {
    expect(diagnosticFingerprint(base)).toBe("21db57cc3b40c49e");
  });

  it("changes with the rule, chapter, evidence, quotes and facts", () => {
    const fingerprint = diagnosticFingerprint(base);
    const fact = { subject: "Mira", predicate: "location", object: "harbour", validFromChapter: 7, validUntilChapter: null, sourceChapter: 7 };
    const variants: Diagnostic[] = [
      { ...base, ruleId: "continuity/other" },
      { ...base, chapter: 8 },
      { ...base, chapter: undefined },
      { ...base, evidence: ["death: Mira · status · alive"] },
      { ...base, sourceRefs: [{ sourceId: "chapter:7", quote: "Mira walked" }] },
      { ...base, facts: [fact] },
    ];
    const fingerprints = variants.map(diagnosticFingerprint);
    expect(fingerprints).not.toContain(fingerprint);
    expect(new Set(fingerprints).size).toBe(variants.length);
  });
});

describe("applySuppressions", () => {
  const other: Diagnostic = { ...base, ruleId: "style/other", code: "other", chapter: 2 };
  const later: Diagnostic = { ...base, chapter: 9, evidence: ["death: Mira · status · dead (ch9)"] };
  const rule: Suppression = { kind: "rule", ruleId: base.ruleId, reason: "ghost story", createdAt };

  it("keeps everything when nothing is suppressed", () => {
    expect(applySuppressions([base, other], [])).toEqual({ kept: [base, other], suppressed: [] });
  });

  it("hides every finding of a suppressed rule", () => {
    expect(applySuppressions([base, other, later], [rule])).toEqual({
      kept: [other],
      suppressed: [{ diagnostic: base, suppression: rule }, { diagnostic: later, suppression: rule }],
    });
  });

  it("hides only the matching instance, and prefers it over a rule suppression", () => {
    const instance: Suppression = {
      kind: "instance", ruleId: base.ruleId, fingerprint: diagnosticFingerprint(base), reason: "flashback", createdAt,
    };
    expect(applySuppressions([base, other, later], [instance])).toEqual({
      kept: [other, later],
      suppressed: [{ diagnostic: base, suppression: instance }],
    });
    expect(applySuppressions([base], [rule, instance]).suppressed[0]!.suppression).toBe(instance);
  });

  it("does not match an instance fingerprint under another rule", () => {
    const instance: Suppression = {
      kind: "instance", ruleId: "style/other", fingerprint: diagnosticFingerprint(base), reason: "x", createdAt,
    };
    expect(applySuppressions([base], [instance]).kept).toEqual([base]);
  });
});
