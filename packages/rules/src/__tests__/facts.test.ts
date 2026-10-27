import { describe, expect, it } from "vitest";
import { firstOverlap, nested, normalizeValue, parseQuantity } from "../rules/facts.js";
import { fact } from "./fixtures.js";

describe("fact helpers", () => {
  it("finds the first chapter two facts share, with inclusive ends", () => {
    expect(firstOverlap(fact("a", "p", "x", 2, 5), fact("a", "p", "y", 5))).toBe(5);
    expect(firstOverlap(fact("a", "p", "x", 2, 4), fact("a", "p", "y", 5))).toBeNull();
    expect(firstOverlap(fact("a", "p", "x", 1), fact("a", "p", "y", 3, 9))).toBe(3);
    // Superseded in the chapter that added it: never valid.
    expect(firstOverlap(fact("a", "p", "x", 4, 3), fact("a", "p", "y", 1))).toBeNull();
  });

  it("normalizes values and detects nesting", () => {
    expect(normalizeValue("  The Harbour Docks. ")).toBe("harbourdocks");
    expect(nested(normalizeValue("harbour"), normalizeValue("the harbour docks"))).toBe(true);
    expect(nested(normalizeValue("城门"), normalizeValue("京城城门"))).toBe(true);
    expect(nested(normalizeValue("harbour"), normalizeValue("chapel"))).toBe(false);
  });

  it("parses numbers with signs, commas, units and Chinese numerals", () => {
    expect(parseQuantity("-1,200 gold")).toEqual({ value: -1200, unit: "gold" });
    expect(parseQuantity("−5")).toEqual({ value: -5, unit: "" });
    expect(parseQuantity("minus 3 arrows")).toEqual({ value: -3, unit: "arrows" });
    expect(parseQuantity("12.5")).toEqual({ value: 12.5, unit: "" });
    expect(parseQuantity("负50灵石")).toEqual({ value: -50, unit: "灵石" });
    expect(parseQuantity("负三十枚金币")).toEqual({ value: -30, unit: "枚金币" });
    expect(parseQuantity("三十两")).toEqual({ value: 30, unit: "两" });
    expect(parseQuantity("一千两百")).toEqual({ value: 1200, unit: "" });
    expect(parseQuantity("两万")).toEqual({ value: 20000, unit: "" });
    expect(parseQuantity("十七岁")).toEqual({ value: 17, unit: "岁" });
    expect(parseQuantity("seventeen")).toEqual({ value: 17, unit: "" });
    expect(parseQuantity("Twenty-one years old")).toEqual({ value: 21, unit: "years old" });
    expect(parseQuantity("eight passengers")).toEqual({ value: 8, unit: "passengers" });
    expect(parseQuantity("minus four shillings")).toEqual({ value: -4, unit: "shillings" });
    for (const text of ["someone", "seventh", "ones", "-5 to 10", "about -5", "a few", "5%", "-3 (after the fight)", "1,2"]) expect(parseQuantity(text)).toBeNull();
  });
});
