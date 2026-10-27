import type { Diagnostic } from "@plotlint/diagnostics";
import { Editor } from "@tiptap/core";
import { Diagnostics, PlainTextDocument, textToDoc, type DiagnosticsOptions } from "../index.js";

export const SOURCE = "chapter:1";

export function diagnostic(start: number, end: number, overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: "test",
    ruleId: "mechanics/test",
    layer: "mechanics",
    severity: "warning",
    confidence: "deterministic",
    summary: "test finding",
    evidence: ["quoted"],
    range: { sourceId: SOURCE, start, end },
    ...overrides,
  };
}

export function createEditor(text: string, options: DiagnosticsOptions = {}): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  return new Editor({
    element,
    extensions: [...PlainTextDocument, Diagnostics.configure(options)],
    content: textToDoc(text),
  });
}

/** Text under each drawn diagnostic, by id, read from the rendered DOM. */
export function renderedSquiggles(editor: Editor): Record<string, string> {
  const result: Record<string, string> = {};
  for (const span of editor.view.dom.querySelectorAll<HTMLElement>("[data-diagnostic-id]")) {
    const id = span.dataset.diagnosticId!;
    result[id] = (result[id] ?? "") + span.textContent;
  }
  return result;
}
