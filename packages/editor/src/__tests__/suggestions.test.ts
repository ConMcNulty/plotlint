import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { PlainTextDocument, Suggestions, docToText, getSuggestions, suggestionsBetween, textToDoc } from "../index.js";

const BASE = "# Chapter 1\n\nMira walked to the pier.\n\nThe tide was out.";
const PROPOSED = "# Chapter 1\n\nMira ran down to the old pier.\n\nThe tide was out.\nGulls cried.";

let editor: Editor;
afterEach(() => editor?.destroy());

function setup(onChange = vi.fn()) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: [...PlainTextDocument, Suggestions.configure({ onChange })], content: textToDoc(PROPOSED) });
  editor.commands.suggestFromBase(BASE);
  return onChange;
}

describe("suggestionsBetween", () => {
  it("merges adjacent removals and insertions into changes in the proposed text's offsets", () => {
    const changes = suggestionsBetween(BASE, PROPOSED);
    expect(changes.map((change) => [PROPOSED.slice(change.start, change.end), change.deleted])).toEqual([
      ["ran down ", "walked "],
      ["old ", ""],
      ["\nGulls cried.", ""],
    ]);
    expect(suggestionsBetween(BASE, BASE)).toEqual([]);
  });
});

describe("Suggestions extension", () => {
  it("shows each change with the removed words and leaves the text as proposed", () => {
    const onChange = setup();
    expect(getSuggestions(editor.state)).toHaveLength(3);
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ deleted: "walked " })]));
    expect(docToText(editor.state.doc)).toBe(PROPOSED);
    const dom = editor.view.dom;
    expect([...dom.querySelectorAll(".pl-suggestion-insert")].map((node) => node.textContent).join("|")).toContain("ran down");
    expect([...dom.querySelectorAll(".pl-suggestion-delete")].map((node) => node.textContent)).toEqual(["walked "]);
  });

  it("keeps the agent's words on accept and puts the old ones back on reject", () => {
    setup();
    const [ran, old, gulls] = getSuggestions(editor.state);
    editor.commands.rejectSuggestion(ran!.id);
    expect(docToText(editor.state.doc)).toBe("# Chapter 1\n\nMira walked to the old pier.\n\nThe tide was out.\nGulls cried.");
    editor.commands.acceptSuggestion(old!.id);
    // The last change spans a line break; rejecting it removes the added line.
    editor.commands.rejectSuggestion(gulls!.id);
    expect(docToText(editor.state.doc)).toBe("# Chapter 1\n\nMira walked to the old pier.\n\nThe tide was out.");
    expect(getSuggestions(editor.state)).toEqual([]);
  });

  it("rejects everything back to the base text, and restores removed line breaks", () => {
    const element = document.createElement("div");
    document.body.append(element);
    editor = new Editor({ element, extensions: [...PlainTextDocument, Suggestions], content: textToDoc("One. Two.") });
    editor.commands.suggestFromBase("One.\n\nTwo.");
    editor.commands.rejectAllSuggestions();
    expect(docToText(editor.state.doc)).toBe("One.\n\nTwo.");

    editor.commands.setContent(textToDoc(PROPOSED));
    editor.commands.suggestFromBase(BASE);
    expect(editor.commands.rejectAllSuggestions()).toBe(true);
    expect(docToText(editor.state.doc)).toBe(BASE);
  });

  it("follows the writer's edits and runs the buttons in the text", () => {
    setup();
    editor.commands.insertContentAt(1, "X");
    const ran = getSuggestions(editor.state)[0]!;
    expect(editor.state.doc.textBetween(ran.from, ran.to)).toBe("ran down ");
    const reject = editor.view.dom.querySelector<HTMLElement>(`[data-suggestion-action=reject][data-suggestion-id=${ran.id}]`)!;
    reject.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(docToText(editor.state.doc)).toContain("Mira walked to the old pier.");
    expect(getSuggestions(editor.state)).toHaveLength(2);
  });
});
