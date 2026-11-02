// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiagnosticEntry } from "@plotlint/editor";
import type { TFunction } from "../../../hooks/use-i18n";
import { ManuscriptEditor, type ManuscriptEditorHandle } from "../ManuscriptEditor";
import { ProblemsPanel } from "../ProblemsPanel";
import { LAYER_ORDER, mentionRange, problemRows, rowTarget, visibleProblems, type ProblemRow } from "../problems-model";
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

  it("keeps chapter-level structure findings, with where their fact was established as the click target", () => {
    const established = { chapter: 2, start: 10, end: 27, quote: "Mira died at dawn" };
    const structure = problemRows(
      [entry("m", 0, finding({ ruleId: "metrics/wall-of-text", layer: "metrics", severity: "note", summary: "wall" }))],
      [
        finding({ ruleId: "structure/unpaid-setup", layer: "structure", severity: "note", confidence: "extracted", summary: "never returns", fingerprint: "u", established }),
        finding({ ruleId: "structure/open-questions", layer: "structure", severity: "note", confidence: "extracted", summary: "questions pile up", fingerprint: "q" }),
      ],
      () => 1,
    );
    expect(structure.map(rowTarget)).toEqual([{ kind: "range", entryId: "m" }, { kind: "established", location: established }, null]);
    expect(visibleProblems(structure, { layer: "structure", severity: "all", confidence: "all" }, "position").map((r) => r.diagnostic.summary))
      .toEqual(["never returns", "questions pile up"]);
    expect(visibleProblems(structure, { layer: "metrics", severity: "all", confidence: "all" }, "position").map((r) => r.diagnostic.summary))
      .toEqual(["wall"]);
  });

  it("finds the passage an unranged finding names in this chapter", () => {
    const text = "# Mira Vale\n\nThree days later, Mira Vale walked into the harbour office.";
    const fact = (subject: string, predicate: string, object: string, chapter: number) =>
      ({ subject, predicate, object, validFromChapter: chapter, validUntilChapter: null, sourceChapter: chapter });
    const dead = finding({
      ruleId: "continuity/dead-entity-acts", chapter: 3, evidence: ["death: Mira Vale · status · dead"],
      facts: [fact("Mira Vale", "status", "dead", 2), fact("Mira Vale", "location", "harbour office", 3)],
    });
    // This chapter's fact first (its object), skipping the heading.
    expect(mentionRange(dead, text)).toEqual({ start: text.indexOf("harbour office"), end: text.indexOf("harbour office") + 14 });
    // Then any cited subject, as a whole word.
    expect(mentionRange(finding({ chapter: 3, facts: [fact("Mira Vale", "status", "dead", 2)] }), text))
      .toEqual({ start: text.indexOf("Mira Vale walked"), end: text.indexOf("Mira Vale walked") + 9 });
    // Then quoted words in the evidence.
    expect(mentionRange(finding({ chapter: 3, evidence: ["“three days”"] }), text)).toEqual({ start: 13, end: 23 });
    expect(mentionRange(finding({ chapter: 3, evidence: ["\"arbour\""] }), text)).toBeNull();
    expect(mentionRange(finding({ chapter: 3, evidence: ["\"nowhere\""] }), text)).toBeNull();
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

  it("lists every layer in the filter and links unranged findings to where their fact was established", () => {
    const established = { chapter: 2, start: 0, end: 5, quote: "Mira died" };
    const withLink = [...rows, ...problemRows([], [finding({ ruleId: "structure/unpaid-setup", layer: "structure", summary: "never returns", fingerprint: "u", established })], () => 1)];
    const html = renderToStaticMarkup(React.createElement(ProblemsPanel, {
      rows: withLink, suppressed: 0, linting: false, error: null, stateMissing: false, t, onSelect: () => {}, onNotUseful: () => {},
    }));
    for (const layer of LAYER_ORDER) expect(html).toContain(`<option value="${layer}">`);
    expect(html).toContain("metrics (0)");
    expect(html).toMatch(/data-testid="problem-established"[^>]*>.*state\.established.*ch.*2/);
    expect(html.match(/data-testid="problem-not-useful"/g)).toHaveLength(withLink.length);
    // Every row is clickable, with or without a link.
    expect(html).toMatch(/data-rule-id="structure\/unpaid-setup" data-layer="structure" data-ranged="false"[^>]*><button type="button"(?! disabled)/);
    expect(html).toMatch(/data-rule-id="continuity\/dead-entity-acts"[^>]*><button type="button"(?! disabled)/);
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

    const selected = () => {
      const { state } = handle.current!.editor()!;
      return state.doc.textBetween(state.selection.from, state.selection.to);
    };
    const row = container.querySelector<HTMLButtonElement>("li[data-rule-id='mechanics/harper'] button")!;
    await act(async () => { row.click(); });
    expect(selected()).toBe("teh");

    // A whole-chapter finding with nothing to point at goes to the top of the chapter, with a note.
    await act(async () => { container.querySelector<HTMLButtonElement>("li[data-rule-id='continuity/dead-entity-acts'] button")!.click(); });
    expect(handle.current!.editor()!.state.selection.from).toBeLessThanOrEqual(2);
    expect(document.querySelector("[data-testid=goto-notice]")!.textContent).toContain("problems.wholeChapterHint");
  });

  it("jumps to the passage an unranged finding names when it has no recorded passage", async () => {
    const text = "# Chapter 3\n\nMira walked to the quay.";
    const response: LintResponse = {
      sourceId: "chapter:3",
      diagnostics: [finding({
        ruleId: "continuity/dead-entity-acts", layer: "continuity", confidence: "extracted", chapter: 3, summary: "dead acts", fingerprint: "d",
        facts: [{ subject: "Mira", predicate: "location", object: "the quay", validFromChapter: 3, validUntilChapter: null, sourceChapter: 3 }],
      })],
      ranges: null,
      suppressed: 0,
      stateMissing: false,
    };
    const handle = createRef<ManuscriptEditorHandle>();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(ManuscriptEditor, { bookId: "b", chapterNumber: 3, initialText: text, t, handleRef: handle, lint: vi.fn(async () => response) }));
    });
    await act(async () => { await vi.waitFor(() => expect(container.querySelector("[data-testid=problems-count]")!.textContent).toBe("1")); });
    await act(async () => { container.querySelector<HTMLButtonElement>("li[data-rule-id='continuity/dead-entity-acts'] button")!.click(); });
    const { state } = handle.current!.editor()!;
    expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe("the quay");
  });

  it("opens where an unranged finding's fact was established, and records Not useful from a problems row", async () => {
    const text = "# Chapter 3\n\nMira walked to the quay.";
    const established = { chapter: 2, start: 13, end: 30, quote: "Mira died at dawn" };
    const response: LintResponse = {
      sourceId: "chapter:3",
      diagnostics: [
        finding({ ruleId: "structure/unpaid-setup", layer: "structure", severity: "note", confidence: "extracted", chapter: 3, summary: "never returns", fingerprint: "u", established }),
        finding({ ruleId: "metrics/sentence-rhythm", layer: "metrics", severity: "note", chapter: 3, summary: "flat", fingerprint: "m", range: { sourceId: "chapter:3", start: 13, end: 17 } }),
      ],
      ranges: null,
      suppressed: 0,
      stateMissing: false,
    };
    const onOpenLocation = vi.fn();
    const onVerdicts = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(ManuscriptEditor, {
        bookId: "b", chapterNumber: 3, initialText: text, t, lint: vi.fn(async () => response), onOpenLocation, onVerdicts,
      }));
    });
    await act(async () => { await vi.waitFor(() => expect(container.querySelector("[data-testid=problems-count]")!.textContent).toBe("2")); });

    await act(async () => { container.querySelector<HTMLButtonElement>("li[data-rule-id='structure/unpaid-setup'] button")!.click(); });
    expect(onOpenLocation).toHaveBeenCalledWith(established);

    await act(async () => { container.querySelector<HTMLButtonElement>("li[data-rule-id='metrics/sentence-rhythm'] [data-testid=problem-not-useful]")!.click(); });
    expect(onVerdicts).toHaveBeenCalledWith([{ diagnostic: expect.objectContaining({ fingerprint: "m" }), action: "not-useful" }]);
    await act(async () => { await vi.waitFor(() => expect(container.querySelector("[data-testid=problems-count]")!.textContent).toBe("1")); });
    expect(container.querySelector(".pl-diag--metrics")).toBeNull();
  });
});
