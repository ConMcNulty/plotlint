// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { undo } from "@tiptap/pm/history";
import { OffsetMap } from "@plotlint/editor";
import { createChapterEditor, type ChapterEditor } from "../chapter-editor";
import type { LintDiagnostic, LintRequest, LintResponse } from "../lint-client";

const SOURCE = "chapter:3";

function typo(text: string, start: number): LintDiagnostic {
  return {
    code: "spelling",
    ruleId: "mechanics/harper",
    layer: "mechanics",
    severity: "warning",
    confidence: "deterministic",
    category: "quality",
    assessment: "issue",
    chapter: 3,
    summary: "Did you mean \"the\"?",
    evidence: [`"${text.slice(start, start + 3)}"`],
    range: { sourceId: SOURCE, start, end: start + 3 },
    fixes: [{ title: "Replace with \"the\"", replacement: "the" }],
    fingerprint: `fp-${start}`,
  } as LintDiagnostic;
}

const continuity = {
  code: "dead-entity-acts",
  ruleId: "continuity/dead-entity-acts",
  layer: "continuity",
  severity: "error",
  confidence: "extracted",
  category: "quality",
  assessment: "issue",
  chapter: 3,
  summary: "Mira acts after her death",
  evidence: ["Mira status dead (ch2)"],
  fingerprint: "fp-state",
} as LintDiagnostic;

/** A stand-in for the lint route: flags every "teh" in the linted ranges, plus one state finding. */
function fakeLinter() {
  const calls: LintRequest[] = [];
  const lint = vi.fn(async (request: LintRequest): Promise<LintResponse> => {
    calls.push(request);
    const ranges = request.ranges ?? [{ start: 0, end: request.text.length }];
    const diagnostics: LintDiagnostic[] = [];
    for (const range of ranges) {
      for (const match of request.text.slice(range.start, range.end).matchAll(/\bteh\b/g)) {
        diagnostics.push(typo(request.text, range.start + match.index));
      }
    }
    return { sourceId: SOURCE, diagnostics: [...diagnostics, continuity], ranges: request.ranges ? [...request.ranges] : null, suppressed: 2, stateMissing: false };
  });
  return { lint, calls };
}

const TEXT = "# Chapter 3\n\nteh harbour was quiet.\n\nMira saw teh boat.\n\n林远推开门，雨还在下。\r\n";

let controller: ChapterEditor | undefined;
afterEach(() => {
  controller?.destroy();
  controller = undefined;
  document.body.innerHTML = "";
});

function open(text = TEXT) {
  const { lint, calls } = fakeLinter();
  const element = document.createElement("div");
  document.body.append(element);
  controller = createChapterEditor({ element, text, sourceId: SOURCE, lint, debounceMs: 5 });
  return { controller, lint, calls, element };
}

const posOf = (editor: ChapterEditor, offset: number) => OffsetMap.fromDoc(editor.editor.state.doc).toPos(offset);

describe("chapter editor", () => {
  it("round-trips the chapter text exactly, including blank lines, CRLF and CJK", () => {
    for (const text of [TEXT, "", "\n\n\n", "one\n\n\ntwo\n", "  indented\tline  "]) {
      const { controller: editor } = open(text);
      expect(editor.getText()).toBe(text);
      editor.destroy();
      controller = undefined;
    }
  });

  it("lints the whole chapter on open and draws ranged findings; unranged ones go to the problems list", async () => {
    const { controller: editor, calls, element } = open();
    await editor.flush();

    expect(calls[0]).toEqual({ text: TEXT });
    const squiggles = [...element.querySelectorAll("[data-diagnostic-id]")].map((node) => node.textContent);
    expect(squiggles).toEqual(["teh", "teh"]);
    const problems = editor.problems();
    expect(problems.ranged).toHaveLength(2);
    expect(problems.unranged).toEqual([continuity]);
    expect(problems.suppressed).toBe(2);
    expect(problems.linting).toBe(false);
  });

  it("re-lints only the changed paragraph after typing, keeping findings elsewhere", async () => {
    const { controller: editor, calls } = open();
    await editor.flush();

    const line = TEXT.indexOf("Mira saw");
    editor.editor.chain().insertContentAt(posOf(editor, line), "Then teh ").run();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await editor.flush();

    const text = editor.getText();
    const lineStart = text.indexOf("Then teh");
    const lineEnd = text.indexOf("\n", lineStart);
    expect(calls[1]).toEqual({ text, ranges: [{ start: lineStart, end: lineEnd }] });
    expect(editor.problems().ranged.map((entry) => editor.editor.state.doc.textBetween(entry.from, entry.to))).toEqual(["teh", "teh", "teh"]);
  });

  it("applies a quick fix and undoes it", async () => {
    const { controller: editor } = open();
    await editor.flush();
    const first = editor.problems().ranged[0]!;

    expect(editor.applyFix(first.id, 0)).toBe(true);
    expect(editor.getText()).toBe(TEXT.replace("teh harbour", "the harbour"));
    expect(editor.problems().ranged).toHaveLength(1);

    undo(editor.editor.state, editor.editor.view.dispatch);
    expect(editor.getText()).toBe(TEXT);
  });

  it("reveals a finding by selecting its text", async () => {
    const { controller: editor } = open();
    await editor.flush();
    const second = editor.problems().ranged[1]!;
    expect(editor.reveal(second.id)).toBe(true);
    const { from, to } = editor.editor.state.selection;
    expect(editor.editor.state.doc.textBetween(from, to)).toBe("teh");
    expect([from, to]).toEqual([second.from, second.to]);
  });

  it("reports a failed lint and retries the whole chapter", async () => {
    const element = document.createElement("div");
    document.body.append(element);
    const lint = vi.fn()
      .mockRejectedValueOnce(new Error("server down"))
      .mockResolvedValue({ sourceId: SOURCE, diagnostics: [], ranges: null, suppressed: 0, stateMissing: true });
    controller = createChapterEditor({ element, text: "abc", sourceId: SOURCE, lint, debounceMs: 5 });
    await vi.waitFor(() => expect(controller!.problems()).toMatchObject({ error: "server down", linting: false }));
    expect(lint).toHaveBeenCalledTimes(1);

    await controller.relintAll();
    expect(lint).toHaveBeenLastCalledWith({ text: "abc" });
    expect(controller.problems()).toMatchObject({ error: null, stateMissing: true });
  });
});
