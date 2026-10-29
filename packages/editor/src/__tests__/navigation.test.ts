import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import {
  Navigation,
  PlainTextDocument,
  nameCandidatesAt,
  selectionTextRange,
  textToDoc,
  wordRangeAt,
  type NavigationOptions,
} from "../index.js";

const TEXT = "# Chapter 2\n\nCaptain Aurel Harrow met Mira Okonkwo-Hale at the pier.\n\nMira's key was cold.\n\n林远推开门，雨还在下。";
const at = (word: string, from = 0) => TEXT.indexOf(word, from);

let editor: Editor;
afterEach(() => editor?.destroy());

function setup(options: NavigationOptions = {}) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: [...PlainTextDocument, Navigation.configure(options)], content: textToDoc(TEXT) });
  return editor;
}

describe("wordRangeAt", () => {
  it("finds the word under or just before the offset", () => {
    const start = at("Harrow");
    expect(wordRangeAt(TEXT, start + 2)).toEqual({ start, end: start + 6 });
    expect(wordRangeAt(TEXT, start + 6)).toEqual({ start, end: start + 6 });
    expect(wordRangeAt(TEXT, at("\n\nMira's") + 1)).toBeNull();
  });

  it("segments CJK text into words", () => {
    // Word boundaries come from the runtime's ICU data; only check the word is inside the clause.
    const offset = at("林远") + 1;
    const range = wordRangeAt(TEXT, offset)!;
    expect(range.start).toBeLessThanOrEqual(offset);
    expect(range.end).toBeGreaterThan(offset);
    expect("林远推开门".includes(TEXT.slice(range.start, range.end))).toBe(true);
  });
});

describe("nameCandidatesAt", () => {
  const cursor = (offset: number) => ({ start: offset, end: offset });

  it("grows a capitalised word to the name around it, then falls back", () => {
    expect(nameCandidatesAt(TEXT, cursor(at("Aurel") + 1))).toEqual(["Captain Aurel Harrow", "Aurel"]);
    expect(nameCandidatesAt(TEXT, cursor(at("Hale") + 1))).toEqual(["Mira Okonkwo-Hale", "Okonkwo-Hale", "Hale"]);
    expect(nameCandidatesAt(TEXT, cursor(at("pier") + 1))).toEqual(["pier"]);
  });

  it("drops a possessive and does not join names across punctuation or lines", () => {
    expect(nameCandidatesAt(TEXT, cursor(at("Mira's") + 1))).toEqual(["Mira"]);
    expect(nameCandidatesAt(TEXT, cursor(at("Chapter") + 1))).toEqual(["Chapter"]);
  });

  it("uses a selection as it is, whitespace collapsed", () => {
    const start = at("Mira Okonkwo");
    expect(nameCandidatesAt(TEXT, { start, end: start + "Mira Okonkwo-Hale".length })).toEqual(["Mira Okonkwo-Hale"]);
    expect(nameCandidatesAt("Mira\n  Vale", { start: 0, end: 11 })).toEqual(["Mira Vale"]);
  });
});

describe("Navigation extension", () => {
  it("selects a text range and reads the selection back as text offsets", () => {
    setup();
    const start = at("Mira Okonkwo-Hale");
    const range = { start, end: start + "Mira Okonkwo-Hale".length };
    expect(editor.commands.selectTextRange(range)).toBe(true);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe("Mira Okonkwo-Hale");
    expect(selectionTextRange(editor.state)).toEqual(range);
    expect(editor.storage.navigation.selection()).toEqual(range);

    // Clamped to the document.
    editor.commands.selectTextRange({ start: TEXT.length - 2, end: TEXT.length + 50 });
    expect(selectionTextRange(editor.state)).toEqual({ start: TEXT.length - 2, end: TEXT.length });
  });

  it("asks for the selection's name on F12", () => {
    const onGoToDefinition = vi.fn();
    setup({ onGoToDefinition });
    const start = at("Harrow");
    editor.commands.selectTextRange({ start: start + 1, end: start + 1 });
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", bubbles: true }));
    expect(onGoToDefinition).toHaveBeenCalledTimes(1);
    expect(onGoToDefinition.mock.calls[0]![0]).toMatchObject({
      names: ["Captain Aurel Harrow", "Harrow"],
      range: { start: start + 1, end: start + 1 },
      text: TEXT,
    });
  });

  it("asks for references on Shift+F12, and not for the definition", () => {
    const onGoToDefinition = vi.fn();
    const onFindReferences = vi.fn();
    setup({ onGoToDefinition, onFindReferences });
    const start = at("Harrow");
    editor.commands.selectTextRange({ start: start + 1, end: start + 1 });
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", shiftKey: true, bubbles: true }));
    expect(onFindReferences).toHaveBeenCalledTimes(1);
    expect(onFindReferences.mock.calls[0]![0]).toMatchObject({ names: ["Captain Aurel Harrow", "Harrow"] });
    expect(onGoToDefinition).not.toHaveBeenCalled();
  });

  it("leaves F12 alone without a handler", () => {
    setup();
    const event = new KeyboardEvent("keydown", { key: "F12", bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("looks up the selection on a Ctrl+click inside it, and the word under the pointer elsewhere", () => {
    const onGoToDefinition = vi.fn();
    setup({ onGoToDefinition });
    const start = at("Mira Okonkwo");
    editor.commands.selectTextRange({ start, end: start + 4 });
    // jsdom has no layout; place the pointer by position.
    const map = { inside: editor.state.selection.from + 1, outside: editor.state.selection.from + 27 };
    let target = map.inside;
    editor.view.posAtCoords = () => ({ pos: target, inside: -1 });

    editor.view.dom.dispatchEvent(new MouseEvent("mousedown", { button: 0, ctrlKey: true, bubbles: true }));
    expect(onGoToDefinition.mock.calls[0]![0].names).toEqual(["Mira"]);

    target = map.outside;
    const event = new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onGoToDefinition.mock.calls[1]![0].names).toEqual(["pier"]);

    // A plain click does nothing.
    editor.view.dom.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    expect(onGoToDefinition).toHaveBeenCalledTimes(2);
  });
});
