import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { docToText, OffsetMap, renderDiagnosticDetails, type ChangedRanges, type DiagnosticEntry } from "../index.js";
import { createEditor, diagnostic, renderedSquiggles, SOURCE } from "./helpers.js";

const TEXT = "The quick brown fox.\n\nIt jumps over teh lazy dog.\n\n林远推开门，雨还在下。";
const at = (word: string) => ({ start: TEXT.indexOf(word), end: TEXT.indexOf(word) + word.length });

let editor: Editor;
afterEach(() => editor?.destroy());

function setup(options: Parameters<typeof createEditor>[1] = {}) {
  editor = createEditor(TEXT, options);
  return editor;
}

/** ProseMirror position of a plain-text offset in the editor's current document. */
const pos = (offset: number) => OffsetMap.fromDoc(editor.state.doc).toPos(offset);

function typo() {
  const { start, end } = at("teh");
  return diagnostic(start, end, { ruleId: "mechanics/spelling", fixes: [{ title: "Change to the", replacement: "the" }] });
}

describe("Diagnostics decorations", () => {
  it("underlines the right text with layer, severity and confidence classes", () => {
    setup();
    const quick = at("quick");
    const han = at("雨还在下");
    editor.commands.setDiagnostics([
      typo(),
      diagnostic(quick.start, quick.end, { ruleId: "style/adverb", layer: "style", severity: "note", confidence: "judged" }),
      diagnostic(han.start, han.end, { ruleId: "continuity/weather", layer: "continuity", severity: "error", confidence: "extracted" }),
    ], { sourceId: SOURCE });

    expect(Object.values(renderedSquiggles(editor)).sort()).toEqual(["quick", "teh", "雨还在下"].sort());
    const span = editor.view.dom.querySelector<HTMLElement>(".pl-diag--continuity")!;
    expect(span.className).toBe("pl-diag pl-diag--continuity pl-diag--error pl-diag--extracted");
    expect(span.textContent).toBe("雨还在下");
    expect(editor.storage.diagnostics.all().map((entry) => entry.id)).toEqual([
      `style/adverb:${quick.start}-${quick.end}`,
      `mechanics/spelling:${at("teh").start}-${at("teh").end}`,
      `continuity/weather:${han.start}-${han.end}`,
    ]);
  });

  it("ignores diagnostics without a range, for another source, or out of bounds", () => {
    setup();
    const { range: _range, ...rangeless } = diagnostic(0, 3);
    editor.commands.setDiagnostics([
      rangeless,
      diagnostic(0, 3, { range: { sourceId: "chapter:2", start: 0, end: 3 } }),
      diagnostic(0, TEXT.length + 5),
      diagnostic(4, 9),
    ], { sourceId: SOURCE });
    expect(Object.values(renderedSquiggles(editor))).toEqual(["quick"]);
  });

  it("widens a zero-width range to one character", () => {
    setup();
    const dot = TEXT.indexOf(".");
    editor.commands.setDiagnostics([diagnostic(dot, dot)], { sourceId: SOURCE });
    expect(Object.values(renderedSquiggles(editor))).toEqual(["."]);
  });

  it("suffixes duplicate ids and accepts a custom id", () => {
    setup({ getId: (d, index) => (d.code === "custom" ? "mine" : `${d.ruleId}:${index}`) });
    editor.commands.setDiagnostics([diagnostic(0, 3, { code: "custom" }), diagnostic(0, 3, { code: "custom" }), diagnostic(4, 9)], { sourceId: SOURCE });
    expect(editor.storage.diagnostics.all().map((entry) => entry.id).sort()).toEqual(["mechanics/test:2", "mine", "mine#2"]);
  });

  it("clears diagnostics", () => {
    setup();
    editor.commands.setDiagnostics([typo()], { sourceId: SOURCE });
    editor.commands.clearDiagnostics();
    expect(editor.storage.diagnostics.all()).toEqual([]);
    expect(editor.view.dom.querySelector(".pl-diag")).toBeNull();
  });

  it("finds diagnostics at a position", () => {
    setup();
    const { start, end } = at("teh");
    editor.commands.setDiagnostics([typo(), diagnostic(start - 5, end)], { sourceId: SOURCE });
    expect(editor.storage.diagnostics.diagnosticsAt(pos(start + 1)).length).toBe(2);
    expect(editor.storage.diagnostics.diagnosticsAt(pos(start - 3)).length).toBe(1);
    expect(editor.storage.diagnostics.diagnosticsAt(pos(0))).toEqual([]);
  });
});

describe("mapping through edits", () => {
  it("moves with inserts and deletes before the range", () => {
    setup();
    editor.commands.setDiagnostics([typo()], { sourceId: SOURCE });
    editor.commands.insertContentAt(pos(4), "very ");
    expect(Object.values(renderedSquiggles(editor))).toEqual(["teh"]);
    editor.commands.deleteRange({ from: pos(0), to: pos(4) });
    expect(Object.values(renderedSquiggles(editor))).toEqual(["teh"]);
    expect(editor.storage.diagnostics.all()[0]!.stale).toBe(false);
    editor.commands.insertContentAt(pos(docToText(editor.state.doc).indexOf("lazy")), "big ");
    expect(Object.values(renderedSquiggles(editor))).toEqual(["teh"]);
  });

  it("does not grow or go stale when typing right at its edges", () => {
    setup();
    editor.commands.setDiagnostics([typo()], { sourceId: SOURCE });
    const { start, end } = at("teh");
    editor.commands.insertContentAt(pos(end), "x");
    editor.commands.insertContentAt(pos(start), "y");
    expect(Object.values(renderedSquiggles(editor))).toEqual(["teh"]);
    expect(editor.storage.diagnostics.all()[0]!.stale).toBe(false);
  });

  it("marks a diagnostic stale when an insert lands inside it", () => {
    setup();
    editor.commands.setDiagnostics([typo()], { sourceId: SOURCE });
    editor.commands.insertContentAt(pos(at("teh").start + 1), "h");
    const [entry] = editor.storage.diagnostics.all();
    expect(entry!.stale).toBe(true);
    expect(Object.values(renderedSquiggles(editor))).toEqual(["theh"]);
    expect(editor.view.dom.querySelector(".pl-diag--stale")?.textContent).toBe("theh");
  });

  it("marks a diagnostic stale when a delete overlaps it, and drops it when it is deleted", () => {
    setup();
    const quick = at("quick");
    editor.commands.setDiagnostics([typo(), diagnostic(quick.start, quick.end)], { sourceId: SOURCE });
    editor.commands.deleteRange({ from: pos(at("teh").start + 2), to: pos(at("teh").end + 5) });
    expect(editor.storage.diagnostics.all().filter((entry) => entry.stale).map((entry) => editor.state.doc.textBetween(entry.from, entry.to))).toEqual(["te"]);
    editor.commands.deleteRange({ from: pos(quick.start - 1), to: pos(quick.end + 1) });
    expect(editor.storage.diagnostics.all().map((entry) => entry.diagnostic.ruleId)).toEqual(["mechanics/spelling"]);
  });

  it("drops edited diagnostics in drop mode", () => {
    setup({ staleMode: "drop" });
    editor.commands.setDiagnostics([typo()], { sourceId: SOURCE });
    editor.commands.insertContentAt(pos(at("teh").start + 1), "h");
    expect(editor.storage.diagnostics.all()).toEqual([]);
  });

  it("maps late lint results from an older version through later edits", () => {
    setup();
    const snapshot = editor.storage.diagnostics.lintSnapshot();
    expect(snapshot.text).toBe(TEXT);
    editor.commands.insertContentAt(pos(0), "Once more. ");
    editor.commands.insertContentAt(pos(TEXT.indexOf("lazy") + 11 + 1), "Z");
    const quick = at("quick");
    editor.commands.setDiagnostics([typo(), diagnostic(quick.start, quick.end)], { sourceId: SOURCE, version: snapshot.version });
    const entries = editor.storage.diagnostics.all();
    expect(entries.map((entry) => [editor.state.doc.textBetween(entry.from, entry.to), entry.stale])).toEqual([["quick", false], ["teh", false]]);
  });

  it("refuses results for a version older than the kept history", () => {
    setup({ historyLimit: 2 });
    const { version } = editor.storage.diagnostics.lintSnapshot();
    for (let i = 0; i < 3; i++) editor.commands.insertContentAt(pos(0), "x");
    editor.commands.setDiagnostics([diagnostic(0, 3)], { sourceId: SOURCE, version });
    expect(editor.storage.diagnostics.all()).toEqual([]);
  });
});

describe("quick fixes", () => {
  it("replaces the range with the fix", () => {
    setup();
    editor.commands.setDiagnostics([typo()], { sourceId: SOURCE });
    const [entry] = editor.storage.diagnostics.all();
    expect(editor.commands.applyDiagnosticFix(entry!.id, 0)).toBe(true);
    expect(docToText(editor.state.doc)).toBe(TEXT.replace("teh", "the"));
    expect(editor.storage.diagnostics.all()).toEqual([]);
  });

  it("applies at the mapped range after edits elsewhere", () => {
    setup();
    editor.commands.setDiagnostics([typo()], { sourceId: SOURCE });
    editor.commands.insertContentAt(pos(0), "Well. ");
    expect(editor.commands.applyDiagnosticFix(editor.storage.diagnostics.all()[0]!.id)).toBe(true);
    expect(docToText(editor.state.doc)).toBe(`Well. ${TEXT.replace("teh", "the")}`);
  });

  it("deletes for an empty replacement and splits paragraphs on newlines", () => {
    setup();
    const quick = at("quick ");
    const fox = at("fox.");
    editor.commands.setDiagnostics([
      diagnostic(quick.start, quick.end, { fixes: [{ title: "Delete", replacement: "" }] }),
      diagnostic(fox.start, fox.end, { fixes: [{ title: "Split", replacement: "fox.\n\nThe end." }] }),
    ], { sourceId: SOURCE });
    const [first, second] = editor.storage.diagnostics.all();
    editor.commands.applyDiagnosticFix(first!.id);
    editor.commands.applyDiagnosticFix(second!.id);
    expect(docToText(editor.state.doc)).toBe(TEXT.replace("quick ", "").replace("fox.", "fox.\n\nThe end."));
  });

  it("refuses stale diagnostics, unknown ids and missing fixes", () => {
    setup();
    editor.commands.setDiagnostics([typo()], { sourceId: SOURCE });
    const id = editor.storage.diagnostics.all()[0]!.id;
    expect(editor.commands.applyDiagnosticFix(id, 3)).toBe(false);
    expect(editor.commands.applyDiagnosticFix("nope")).toBe(false);
    editor.commands.insertContentAt(pos(at("teh").start + 1), "x");
    const before = docToText(editor.state.doc);
    expect(editor.commands.applyDiagnosticFix(id)).toBe(false);
    expect(docToText(editor.state.doc)).toBe(before);
  });
});

describe("change tracking for re-lint", () => {
  it("reports changed paragraphs since the last lint", () => {
    const calls: ChangedRanges[] = [];
    setup({ onChangedRanges: (changed) => calls.push(changed) });
    editor.commands.setDiagnostics([], { sourceId: SOURCE });
    editor.commands.insertContentAt(pos(at("jumps").start), "x");
    let text = docToText(editor.state.doc);
    const second = { start: text.indexOf("It"), end: text.indexOf("dog.") + 4 };
    expect(calls.at(-1)!.ranges).toEqual([{ ...second, firstBlock: 2, lastBlock: 2 }]);
    expect(calls.at(-1)!.sourceId).toBe(SOURCE);

    editor.commands.insertContentAt(pos(text.length), "！");
    text = docToText(editor.state.doc);
    const changed = calls.at(-1)!;
    expect(changed.ranges.map((range) => text.slice(range.start, range.end))).toEqual([
      "It xjumps over teh lazy dog.",
      "林远推开门，雨还在下。！",
    ]);

    // A partial re-lint of the first changed paragraph clears only that one.
    editor.commands.setDiagnostics([], { sourceId: SOURCE, version: changed.version, ranges: [changed.ranges[0]!] });
    expect(calls.at(-1)!.ranges.map((range) => text.slice(range.start, range.end))).toEqual(["林远推开门，雨还在下。！"]);
    // A full lint at the current version clears everything.
    editor.commands.setDiagnostics([], { sourceId: SOURCE, version: changed.version });
    expect(calls.at(-1)!.ranges).toEqual([]);
  });

  it("keeps diagnostics `keep` picks through a partial re-lint", () => {
    setup();
    const lazy = at("lazy");
    const jumps = at("jumps");
    editor.commands.setDiagnostics([
      diagnostic(lazy.start, lazy.end, { ruleId: "metrics/wall-of-text", layer: "metrics", severity: "note" }),
      diagnostic(jumps.start, jumps.end, { ruleId: "style/verb", layer: "style", severity: "note" }),
    ], { sourceId: SOURCE });
    editor.commands.insertContentAt(pos(at("over").start), "x");
    const changed = editor.storage.diagnostics.changedRanges();
    editor.commands.setDiagnostics([], {
      sourceId: SOURCE, version: changed.version, ranges: changed.ranges, keep: (found) => found.layer === "metrics",
    });
    expect(editor.storage.diagnostics.all().map((entry) => entry.diagnostic.ruleId)).toEqual(["metrics/wall-of-text"]);
  });

  it("keeps edits made after the linted version dirty", () => {
    setup();
    editor.commands.insertContentAt(pos(0), "a");
    const { version } = editor.storage.diagnostics.changedRanges();
    editor.commands.insertContentAt(pos(docToText(editor.state.doc).length), "b");
    editor.commands.setDiagnostics([], { sourceId: SOURCE, version });
    const text = docToText(editor.state.doc);
    expect(editor.storage.diagnostics.changedRanges().ranges.map((range) => text.slice(range.start, range.end))).toEqual(["林远推开门，雨还在下。b"]);
  });

  it("merges edits across a paragraph split into one range", () => {
    setup();
    editor.commands.setDiagnostics([], { sourceId: SOURCE });
    editor.commands.setTextSelection(pos(at("over").start));
    editor.commands.splitBlock();
    const text = docToText(editor.state.doc);
    const ranges = editor.storage.diagnostics.changedRanges().ranges;
    expect(ranges.map((range) => text.slice(range.start, range.end))).toEqual(["It jumps \nover teh lazy dog."]);
  });

  it("replaces only diagnostics inside re-linted ranges", () => {
    setup();
    const quick = at("quick");
    editor.commands.setDiagnostics([typo(), diagnostic(quick.start, quick.end)], { sourceId: SOURCE });
    editor.commands.insertContentAt(pos(at("teh").start + 1), "h"); // "theh": the typo goes stale
    const changed = editor.storage.diagnostics.changedRanges();
    const text = docToText(editor.state.doc);
    const lazy = text.indexOf("lazy");
    editor.commands.setDiagnostics(
      [diagnostic(lazy, lazy + 4, { ruleId: "style/lazy" }), diagnostic(quick.start, quick.end, { ruleId: "style/outside" })],
      { sourceId: SOURCE, version: changed.version, ranges: changed.ranges },
    );
    expect(editor.storage.diagnostics.all().map((entry) => [entry.diagnostic.ruleId, editor.state.doc.textBetween(entry.from, entry.to), entry.stale]))
      .toEqual([["mechanics/test", "quick", false], ["style/lazy", "lazy", false]]);
  });
});

describe("hover and cursor", () => {
  it("reports diagnostics at the cursor as it moves", () => {
    const onCursor = vi.fn<(entries: DiagnosticEntry[]) => void>();
    setup({ onCursorDiagnostics: onCursor });
    editor.commands.setDiagnostics([typo()], { sourceId: SOURCE });
    editor.commands.setTextSelection(pos(at("teh").start + 1));
    expect(onCursor.mock.calls.at(-1)![0].map((entry) => entry.diagnostic.ruleId)).toEqual(["mechanics/spelling"]);
    editor.commands.setTextSelection(pos(1));
    expect(onCursor.mock.calls.at(-1)![0]).toEqual([]);
  });

  it("reports diagnostics under the mouse", () => {
    const onHover = vi.fn<(entries: DiagnosticEntry[]) => void>();
    setup({ onHover });
    editor.commands.setDiagnostics([typo()], { sourceId: SOURCE });
    const span = editor.view.dom.querySelector<HTMLElement>(".pl-diag")!;
    // jsdom has no layout, so stand in for posAtCoords.
    editor.view.posAtCoords = () => ({ pos: pos(at("teh").start + 1), inside: -1 });
    span.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 1, clientY: 1 }));
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover.mock.calls[0]![0].map((entry) => entry.diagnostic.ruleId)).toEqual(["mechanics/spelling"]);
    span.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 2, clientY: 1 }));
    expect(onHover).toHaveBeenCalledTimes(1);
    editor.view.dom.dispatchEvent(new MouseEvent("mouseleave"));
    expect(onHover.mock.calls.at(-1)![0]).toEqual([]);
  });

  it("renders a details tooltip with message, rule, confidence, evidence and fixes", () => {
    setup();
    editor.commands.setDiagnostics([typo()], { sourceId: SOURCE });
    const onFix = vi.fn();
    const details = renderDiagnosticDetails(editor.storage.diagnostics.all(), {
      onFix: (entry, index) => { onFix(index); editor.commands.applyDiagnosticFix(entry.id, index); },
    });
    expect(details.querySelector(".pl-diag-details__rule")?.textContent).toBe("mechanics/spelling");
    expect(details.querySelector(".pl-diag-details__confidence")?.textContent).toMatch(/^Deterministic/);
    expect(details.querySelector(".pl-diag-details__message")?.textContent).toBe("test finding");
    expect(details.querySelector(".pl-diag-details__evidence li")?.textContent).toBe("quoted");
    details.querySelector<HTMLButtonElement>(".pl-diag-details__fix")!.click();
    expect(onFix).toHaveBeenCalledWith(0);
    expect(docToText(editor.state.doc)).toContain("over the lazy");
  });
});
