import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { GhostText, PlainTextDocument, docToText, getGhostText, textToDoc, type GhostRequest } from "../index.js";

// jsdom has no layout; scrolling the selection into view needs these.
const emptyRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= emptyRect;
Element.prototype.getClientRects ??= () => [] as unknown as DOMRectList;

const TEXT = "# Chapter 1\n\nMira walked to the pier";

let editor: Editor;
afterEach(() => {
  editor?.destroy();
  vi.useRealTimers();
});

function setup(reply: string | null = " and looked out to sea.") {
  vi.useFakeTimers();
  const suggest = vi.fn(async (_request: GhostRequest) => reply);
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: [...PlainTextDocument, GhostText.configure({ suggest, debounceMs: 100 })], content: textToDoc(TEXT) });
  return suggest;
}

const typeAtEnd = (text: string) => editor.chain().setTextSelection(editor.state.doc.content.size - 1).insertContent(text).run();
const settle = () => vi.advanceTimersByTimeAsync(150);

describe("GhostText", () => {
  it("does nothing until turned on", async () => {
    const suggest = setup();
    typeAtEnd(" slowly");
    await settle();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("asks after a pause at the end of a paragraph, shows the words, and Tab-accept inserts them", async () => {
    const suggest = setup();
    editor.commands.setGhostText(true);
    typeAtEnd(",");
    await settle();
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0]![0]).toEqual({ text: `${TEXT},`, offset: TEXT.length + 1 });
    expect(getGhostText(editor.state)?.text).toBe(" and looked out to sea.");
    expect(editor.view.dom.querySelector(".pl-ghost")?.textContent).toBe(" and looked out to sea.");
    expect(docToText(editor.state.doc)).toBe(`${TEXT},`);

    expect(editor.commands.acceptGhostText()).toBe(true);
    expect(docToText(editor.state.doc)).toBe(`${TEXT}, and looked out to sea.`);
    expect(editor.view.dom.querySelector(".pl-ghost")).toBeNull();
  });

  it("drops the suggestion on typing or Escape, and ignores a reply that arrives after an edit", async () => {
    const suggest = setup();
    editor.commands.setGhostText(true);
    typeAtEnd(",");
    await settle();
    typeAtEnd(" a");
    expect(getGhostText(editor.state)).toBeNull();
    await settle();
    expect(getGhostText(editor.state)).not.toBeNull();
    expect(editor.commands.dismissGhostText()).toBe(true);
    expect(getGhostText(editor.state)).toBeNull();
    expect(editor.commands.acceptGhostText()).toBe(false);

    let resolve: (value: string) => void = () => undefined;
    suggest.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    typeAtEnd("n");
    await settle();
    typeAtEnd("d");
    resolve(" too late");
    await vi.advanceTimersByTimeAsync(0);
    expect(getGhostText(editor.state)?.text).not.toBe(" too late");
  });

  it("does not ask in the middle of a paragraph, and turning off clears it", async () => {
    const suggest = setup();
    editor.commands.setGhostText(true);
    editor.chain().setTextSelection(18).insertContent("x").run();
    await settle();
    expect(suggest).not.toHaveBeenCalled();
    typeAtEnd(".");
    await settle();
    expect(getGhostText(editor.state)).not.toBeNull();
    editor.commands.setGhostText(false);
    expect(getGhostText(editor.state)).toBeNull();
  });
});
