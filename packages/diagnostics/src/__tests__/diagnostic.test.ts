import { describe, expect, it } from "vitest";
import { DiagnosticSchema, formatDiagnostic, sortDiagnostics, type Diagnostic } from "../index.js";

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

describe("DiagnosticSchema", () => {
  it("accepts a well-formed diagnostic", () => {
    expect(DiagnosticSchema.parse(base)).toEqual(base);
  });

  it("rejects a judged finding shown as an error", () => {
    expect(() => DiagnosticSchema.parse({ ...base, confidence: "judged", severity: "error" })).toThrow(/severity note/);
  });

  it("rejects a finding without any evidence", () => {
    expect(() => DiagnosticSchema.parse({ ...base, evidence: [] })).toThrow(/evidence/);
  });
});

describe("sortDiagnostics and formatDiagnostic", () => {
  it("puts errors first and formats like a compiler message", () => {
    const note: Diagnostic = { ...base, severity: "note", chapter: 1 };
    const error: Diagnostic = { ...base, severity: "error", chapter: 9 };
    expect(sortDiagnostics([note, base, error]).map((d) => d.severity)).toEqual(["error", "warning", "note"]);
    expect(formatDiagnostic(base)).toBe(
      "ch7 warning continuity/dead-entity-acts [extracted]: Mira acts after her death.\n    death: Mira · status · dead",
    );
  });
});
