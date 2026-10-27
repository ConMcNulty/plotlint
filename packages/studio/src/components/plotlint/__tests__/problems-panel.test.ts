// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiagnosticEntry } from "@plotlint/editor";
import type { TFunction } from "../../../hooks/use-i18n";
import { ManuscriptEditor, type ManuscriptEditorHandle } from "../ManuscriptEditor";
import { ProblemsPanel } from "../ProblemsPanel";
import { problemRows, visibleProblems, type ProblemRow } from "../problems-model";
import type { LintDiagnostic, LintResponse } from "../lint-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = ((key: string) => key) as TFunction;

const finding = (overrides: Partial<LintDiagnostic>): LintDiagnostic => ({
  code: "x",
  ruleId: "mechanics/harper",
  layer: "mechanics",
  severity: "warning",
  confidence: "deterministic",
  category: "quality",
  assessment: "issue",
  summary: "finding",
  evidence: ["\"quote\""],
  fingerprint: "fp",
  ...overrides,
} as LintDiagnostic);

const entry = (id: string, from: number, diagnostic: LintDiagnostic): DiagnosticEntry => ({ id, from, to: from + 3, diagnostic, stale: false });

const rows: ProblemRow[] = problemRows(
  [
    entry("a", 20, finding({ summary: "spelling", severity: "warning" })),
    entry("b", 5, finding({ ruleId: "style/general.Cliches", layer: "style", severity: "note", summary: "cliche" })),
  ],
  [finding({ ruleId: "continuity/dead-entity-acts", layer: "continuity", severity: "error", confidence: "extracted", summary: "dead acts", fingerprint: "s" })],
  (pos) => (pos < 10 ? 1 : 3),
);

describe("problems model", () => {
  it("sorts by position with whole-chapter findings first, or by severity, layer and confidence", () => {
    expect(visibleProblems(rows, { layer: "all", severity: "all", confidence: "all" }, "position").map((r) => r.diagnostic.summary))
      .toEqual(["dead acts", "cliche", "spelling"]);
    expect(visibleProblems(rows, { layer: "all", severity: "all", confidence: "all" }, "severity").map((r) => r.diagnostic.summary))
      .toEqual(["dead acts", "spelling", "cliche"]);
    expect(visibleProblems(rows, { layer: "all", severity: "all", confidence: "all" }, "layer").map((r) => r.diagnostic.layer))
      .toEqual(["mechanics", "style", "continuity"]);
    expect(visibleProblems(rows, { layer: "all", severity: "all", confidence: "all" }, "confidence").map((r) => r.diagnostic.confidence))
      .toEqual(["deterministic", "deterministic", "extracted"]);
  });

  it("filters by layer, severity and confidence", () => {
    expect(visibleProblems(rows, { layer: "style", severity: "all", confidence: "all" }, "position")).toHaveLength(1);
    expect(visibleProblems(rows, { layer: "all", severity: "error", confidence: "all" }, "position")[0]!.diagnostic.ruleId).toBe("continuity/dead-entity-acts");
    expect(visibleProblems(rows, { layer: "all", severity: "all", confidence: "extracted" }, "position")).toHaveLength(1);
    expect(visibleProblems(rows, { layer: "mechanics", severity: "note", confidence: "all" }, "position")).toEqual([]);
  });
});

describe("ProblemsPanel", () => {
  it("lists ranged and unranged findings with their rule, layer and line, and the suppressed count", () => {
    const html = renderToStaticMarkup(React.createElement(ProblemsPanel, { rows, suppressed: 4, linting: false, error: null, stateMissing: false, t }));
    expect(html).toContain("spelling");
    expect(html).toContain("continuity/dead-entity-acts");
    expect(html).toContain("problems.wholeChapter");
    expect(html).toContain("problems.line 3");
    expect(html).toMatch(/data-testid="problems-suppressed"[^>]*>.*4/);
    expect(html.indexOf("dead acts")).toBeLessThan(html.indexOf("cliche"));
  });

  it("shows the empty and filtered states", () => {
    expect(renderToStaticMarkup(React.createElement(ProblemsPanel, { rows: [], suppressed: 0, linting: true, error: null, stateMissing: true, t })))
      .toContain("problems.none");
    const filtered = renderToStaticMarkup(React.createElement(ProblemsPanel, {
      rows, suppressed: 0, linting: false, error: null, stateMissing: false, t,
      initialFilter: { layer: "judgment", severity: "all", confidence: "all" },
    }));
    expect(filtered).toContain("problems.noMatch");
  });
});

describe("ManuscriptEditor", () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
  });

  it("opens the chapter in the editor, lints it, lists problems and selects one on click", async () => {
    const text = "# Chapter 1\n\nShe saw teh boat.";
    const start = text.indexOf("teh");
    const response: LintResponse = {
      sourceId: "chapter:1",
      diagnostics: [
        finding({ chapter: 1, summary: "Did you mean \"the\"?", range: { sourceId: "chapter:1", start, end: start + 3 }, fixes: [{ title: "Replace with \"the\"", replacement: "the" }] }),
        finding({ ruleId: "continuity/dead-entity-acts", layer: "continuity", severity: "error", confidence: "extracted", summary: "dead acts", fingerprint: "s" }),
      ],
      ranges: null,
      suppressed: 1,
      stateMissing: false,
    };
    const lint = vi.fn(async () => response);
    const handle = createRef<ManuscriptEditorHandle>();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(React.createElement(ManuscriptEditor, { bookId: "b", chapterNumber: 1, initialText: text, t, handleRef: handle, lint }));
    });
    await act(async () => { await vi.waitFor(() => expect(container.querySelector("[data-diagnostic-id]")).not.toBeNull()); });

    expect(lint).toHaveBeenCalledWith({ text });
    expect(container.querySelector("[data-diagnostic-id]")!.textContent).toBe("teh");
    expect(container.querySelector("[data-testid=problems-count]")!.textContent).toBe("2");
    expect(container.querySelector("[data-testid=problems-suppressed]")!.textContent).toContain("1");
    expect(handle.current!.getText()).toBe(text);

    const row = container.querySelector<HTMLButtonElement>("li[data-rule-id='mechanics/harper'] button")!;
    await act(async () => { row.click(); });
    const { state } = handle.current!.editor()!;
    expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe("teh");
  });
});
