import { describe, expect, it } from "vitest";
import { checkText, textDiagnostic, type TextRule } from "../index.js";

const document = { sourceId: "chapter:3", chapter: 3, text: "She very quickly ran. He very slowly walked." };

const veryRule: TextRule = {
  id: "style/very",
  layer: "style",
  rationale: "Intensifiers usually weaken the verb they prop up.",
  check({ document }) {
    return [...document.text.matchAll(/\bvery\b/gu)].map((match) => textDiagnostic({
      rule: this, document, start: match.index!, end: match.index! + match[0].length,
      summary: "Intensifier \"very\".", fixes: [{ title: "Delete \"very\"", replacement: "" }],
    }));
  },
};

describe("checkText", () => {
  it("runs text rules and returns findings in document order with quoted ranges", async () => {
    const diagnostics = await checkText(document, [veryRule]);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((d) => d.range?.start)).toEqual([4, 25]);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "style/very", layer: "style", confidence: "deterministic", chapter: 3,
      evidence: ["\"very\""], sourceRefs: [{ sourceId: "chapter:3", quote: "very" }],
      fixes: [{ title: "Delete \"very\"", replacement: "" }],
    });
  });

  it("supports async rules and passes the dictionary through", async () => {
    const seen: string[][] = [];
    const asyncRule: TextRule = {
      id: "mechanics/probe", layer: "mechanics", rationale: "test",
      async check({ dictionary }) { seen.push([...(dictionary ?? [])]); return []; },
    };
    await checkText(document, [asyncRule], { dictionary: ["Mira"] });
    expect(seen).toEqual([["Mira"]]);
  });

  it("rejects findings without a range inside the document", async () => {
    const bad: TextRule = {
      id: "style/bad", layer: "style", rationale: "test",
      check({ document }) { return [{ ...textDiagnostic({ rule: this, document, start: 0, end: 3, summary: "x" }), range: { sourceId: document.sourceId, start: 0, end: 999 } }]; },
    };
    await expect(checkText(document, [bad])).rejects.toThrow(/valid range/);
  });
});
