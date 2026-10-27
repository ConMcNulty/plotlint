import { describe, expect, it } from "vitest";
import type { TextRule } from "@plotlint/rules";
import {
  effectiveMetricBands, effectiveRuleConfig, PackManifestSchema, PackResolutionError, resolvePacks,
  type LoadedPack, type PackManifest,
} from "../index.js";

const styleRule = (id: string): TextRule => ({ id, layer: "style", rationale: "test", check: () => [] });

function catalog(...packs: Array<Omit<Partial<PackManifest>, "styles"> & { name: string; styles?: string[] }>): Map<string, LoadedPack> {
  return new Map(packs.map(({ styles, ...manifest }) => {
    const parsed = PackManifestSchema.parse({ title: manifest.name, description: manifest.name, ...manifest });
    return [manifest.name, { manifest: parsed, skill: "doc", styleRules: (styles ?? []).map(styleRule) }];
  }));
}

const known = [
  "continuity/knowledge-leak", "continuity/world-rule-broken", "structure/scene-turn", "structure/protagonist-agency",
  "structure/unpaid-setup", "metrics/dialogue-ratio",
];

const base = catalog(
  {
    name: "general",
    styles: ["style/general.Cliches", "style/general.AITells"],
    checks: { "structure/scene-turn": "note", "structure/protagonist-agency": "note" },
    metrics: { "metrics/dialogue-ratio": { min: 0.05, max: 0.9 } },
  },
  {
    name: "mystery",
    styles: ["style/mystery.Cliches"],
    checks: { "continuity/knowledge-leak": "error", "structure/protagonist-agency": "warning" },
    metrics: { "metrics/dialogue-ratio": { min: 0.1 } },
  },
  {
    name: "romance",
    checks: { "structure/protagonist-agency": "off", "continuity/knowledge-leak": { severity: "note", options: { quotes: true } } },
    metrics: { "metrics/dialogue-ratio": { min: 0.15, max: 0.8, window: 3 } },
  },
  { name: "cozy", extends: ["mystery"], checks: { "continuity/knowledge-leak": "warning", "structure/scene-turn": "off" } },
  { name: "literary", checks: { "structure/*": "note", "structure/unpaid-setup": "warning", "style/general.*": "error" } },
);

describe("resolvePacks", () => {
  it("always starts from general", () => {
    const resolved = resolvePacks([], base, { knownRuleIds: known });
    expect(resolved.packs).toEqual(["general"]);
    expect(resolved.config.rules).toEqual({ "structure/scene-turn": "note", "structure/protagonist-agency": "note" });
    expect(resolved.styleRules.map((rule) => rule.id)).toEqual(["style/general.Cliches", "style/general.AITells"]);
    expect(resolved.provenance["structure/scene-turn"]).toEqual(["general"]);
  });

  it("lets a pack override what it extends, general included", () => {
    const resolved = resolvePacks(["cozy"], base, { knownRuleIds: known });
    expect(resolved.packs).toEqual(["general", "mystery", "cozy"]);
    expect(resolved.config.rules).toMatchObject({
      "continuity/knowledge-leak": "warning", "structure/scene-turn": "off", "structure/protagonist-agency": "warning",
    });
    expect(resolved.provenance["continuity/knowledge-leak"]).toEqual(["cozy"]);
    expect(resolved.styleRules.map((rule) => rule.id)).toContain("style/mystery.Cliches");
  });

  it("stacks selected packs with the stricter setting and the narrower band winning", () => {
    const resolved = resolvePacks(["mystery", "romance"], base, { knownRuleIds: known });
    expect(resolved.packs).toEqual(["general", "mystery", "romance"]);
    expect(resolved.config.rules["structure/protagonist-agency"]).toBe("warning");
    expect(resolved.provenance["structure/protagonist-agency"]).toEqual(["mystery"]);
    // error beats note; romance's options still merge in.
    expect(resolved.config.rules["continuity/knowledge-leak"]).toEqual({ severity: "error", options: { quotes: true } });
    expect(resolved.provenance["continuity/knowledge-leak"]).toEqual(["mystery", "romance"]);
    expect(resolved.metrics["metrics/dialogue-ratio"]).toEqual({ min: 0.15, max: 0.8, window: 3 });
    // The same result in either order.
    expect(resolvePacks(["romance", "mystery"], base, { knownRuleIds: known }).config.rules["structure/protagonist-agency"]).toBe("warning");
  });

  it("treats on as stricter than off", () => {
    const packs = catalog({ name: "general" }, { name: "a", checks: { "structure/scene-turn": "off" } }, { name: "b", checks: { "structure/scene-turn": {} } });
    expect(resolvePacks(["a", "b"], packs).config.rules["structure/scene-turn"]).toEqual({});
    expect(resolvePacks(["b", "a"], packs).config.rules["structure/scene-turn"]).toEqual({});
  });

  it("expands globs against known ids and the packs' style rules; exact ids beat globs", () => {
    const resolved = resolvePacks(["literary"], base, { knownRuleIds: known });
    expect(resolved.config.rules).toMatchObject({
      "structure/scene-turn": "note", "structure/protagonist-agency": "note", "structure/unpaid-setup": "warning",
      "style/general.Cliches": "error", "style/general.AITells": "error",
    });
    expect(resolved.unmatchedGlobs).toEqual([]);
    expect(resolvePacks(["literary"], base).unmatchedGlobs).toEqual(["structure/*"]);
  });

  it("rejects unknown packs and extends cycles", () => {
    expect(() => resolvePacks(["horror"], base)).toThrow(/unknown pack "horror"/u);
    const cyclic = catalog({ name: "general" }, { name: "a", extends: ["b"] }, { name: "b", extends: ["a"] });
    expect(() => resolvePacks(["a"], cyclic)).toThrow(PackResolutionError);
    expect(() => resolvePacks(["a"], cyclic)).toThrow("pack extends cycle: a -> b -> a");
  });
});

describe("effectiveRuleConfig", () => {
  it("applies overlays, then the author's rules.json, which always wins", () => {
    const resolved = resolvePacks(["mystery", "romance"], base, { knownRuleIds: known });
    const adaptive = { version: 1 as const, rules: { "structure/protagonist-agency": "note" as const } };
    const author = { version: 1 as const, rules: { "continuity/knowledge-leak": "note" as const, "structure/*": "off" as const } };
    const config = effectiveRuleConfig(resolved, adaptive, author);
    // A bare severity keeps the packs' options.
    expect(config.rules["continuity/knowledge-leak"]).toEqual({ severity: "note", options: { quotes: true } });
    expect(config.rules["structure/protagonist-agency"]).toBe("off");
    expect(config.rules["structure/unpaid-setup"]).toBe("off");
    expect(effectiveRuleConfig(resolved, adaptive).rules["structure/protagonist-agency"]).toBe("note");
    expect(effectiveRuleConfig(resolved, undefined).rules).toEqual(resolved.config.rules);
  });

  it("lets the author widen a metric band through options", () => {
    const resolved = resolvePacks(["romance"], base, { knownRuleIds: known });
    const bands = effectiveMetricBands(resolved, { version: 1, rules: { "metrics/dialogue-ratio": { options: { min: 0 } } } });
    expect(bands["metrics/dialogue-ratio"]).toEqual({ min: 0, max: 0.8, window: 3 });
    expect(resolved.metrics["metrics/dialogue-ratio"]!.min).toBe(0.15);
  });
});

describe("PackManifestSchema", () => {
  it("rejects bad names, keys, settings and bands", () => {
    const ok = { name: "noir", title: "Noir", description: "d" };
    expect(PackManifestSchema.safeParse(ok).success).toBe(true);
    expect(PackManifestSchema.safeParse({ ...ok, name: "Noir" }).success).toBe(false);
    expect(PackManifestSchema.safeParse({ ...ok, checks: { "knowledge leak": "error" } }).success).toBe(false);
    expect(PackManifestSchema.safeParse({ ...ok, checks: { "structure/x": "loud" } }).success).toBe(false);
    expect(PackManifestSchema.safeParse({ ...ok, metrics: { "metrics/x": { min: 3, max: 1 } } }).success).toBe(false);
    expect(PackManifestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});
