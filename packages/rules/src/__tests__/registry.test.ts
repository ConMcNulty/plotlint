import { describe, expect, it } from "vitest";
import type { Rule } from "../index.js";
import { builtinRegistry, builtinRules, checkSnapshot, RuleConfigFileSchema, RuleRegistry } from "../index.js";
import { fact, snapshot } from "./fixtures.js";

const deadActs = snapshot([fact("Mira", "status", "dead", 2), fact("Mira", "location", "harbour", 3)], 3);

describe("rule registry", () => {
  it("holds every built-in rule once, each with a title and rationale", () => {
    const ids = builtinRegistry.list().map((rule) => rule.id);
    expect(ids).toEqual(builtinRules.map((rule) => rule.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of builtinRegistry.list()) {
      expect(rule.title, rule.id).toBeTruthy();
      expect(rule.rationale.length, rule.id).toBeGreaterThan(20);
    }
  });

  it("rejects duplicate and malformed ids", () => {
    const rule: Rule = { id: "continuity/x", layer: "continuity", rationale: "r", check: () => [] };
    expect(() => new RuleRegistry([rule, rule])).toThrow(/already registered/u);
    expect(() => new RuleRegistry([{ ...rule, id: "Continuity/X" }])).toThrow(/kebab/u);
    expect(() => new RuleRegistry([{ ...rule, id: "style/x" }])).toThrow(/layer/u);
  });

  it("applies a book's config: off, a severity, and options", () => {
    const config = RuleConfigFileSchema.parse({ version: 1, rules: {
      "continuity/dead-entity-acts": "error",
      "continuity/two-places-at-once": "off",
      "continuity/item-two-holders": { severity: "note", options: { strict: true } },
      "continuity/typo": "off",
    } });
    const configured = builtinRegistry.configure(config);
    expect(configured.find((c) => c.rule.id === "continuity/dead-entity-acts")).toMatchObject({ enabled: true, severity: "error" });
    expect(configured.find((c) => c.rule.id === "continuity/two-places-at-once")).toMatchObject({ enabled: false });
    expect(configured.find((c) => c.rule.id === "continuity/item-two-holders")).toMatchObject({ severity: "note", options: { strict: true } });
    expect(builtinRegistry.unknownIds(config)).toEqual(["continuity/typo"]);

    expect(checkSnapshot(deadActs, { book: { config } })[0]).toMatchObject({ ruleId: "continuity/dead-entity-acts", severity: "error" });
    const off = RuleConfigFileSchema.parse({ version: 1, rules: { "continuity/dead-entity-acts": "off" } });
    expect(checkSnapshot(deadActs, { book: { config: off } })).toEqual([]);
  });

  it("passes a rule its options", () => {
    let seen: unknown;
    const probe: Rule = { id: "continuity/probe", layer: "continuity", rationale: "r", check: ({ options }) => { seen = options; return []; } };
    const config = RuleConfigFileSchema.parse({ version: 1, rules: { "continuity/probe": { options: { hours: 3 } } } });
    checkSnapshot(deadActs, { rules: [probe], book: { config } });
    expect(seen).toEqual({ hours: 3 });
  });
});
