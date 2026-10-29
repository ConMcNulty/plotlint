import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { FocusMode, OffsetMap, PlainTextDocument, SceneMarkers, docToText, getSceneMarkers, isFocusMode, textToDoc } from "../index.js";

const TEXT = "# Chapter 1\n\nMira walked to the pier.\n\n* * *\n\nThe tide was out.";

let editor: Editor;
afterEach(() => editor?.destroy());

function setup(onSelect = vi.fn()) {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: [...PlainTextDocument, FocusMode, SceneMarkers.configure({ onSelect })], content: textToDoc(TEXT) });
  return onSelect;
}

describe("FocusMode", () => {
  it("dims every paragraph but the cursor's, and only while on", () => {
    setup();
    const dimmed = () => editor.view.dom.querySelectorAll(".pl-focus-dim").length;
    expect(dimmed()).toBe(0);
    editor.commands.setFocusMode(true);
    editor.commands.setTextSelection(OffsetMap.fromDoc(editor.state.doc).toPos(TEXT.indexOf("Mira")));
    expect(isFocusMode(editor.state)).toBe(true);
    expect(editor.view.dom.classList.contains("pl-focus")).toBe(true);
    const paragraphs = editor.view.dom.querySelectorAll("p");
    expect(dimmed()).toBe(paragraphs.length - 1);
    const lit = [...paragraphs].find((node) => !node.classList.contains("pl-focus-dim"));
    expect(lit?.textContent).toBe("Mira walked to the pier.");
    editor.commands.setFocusMode(false);
    expect(dimmed()).toBe(0);
    expect(docToText(editor.state.doc)).toBe(TEXT);
  });
});

describe("SceneMarkers", () => {
  it("draws a marker at the start of the scene's paragraph, keeps it there through edits, and reports clicks", () => {
    const onSelect = setup();
    const offset = TEXT.indexOf("* * *");
    editor.commands.setSceneMarkers([{ id: "ch1.s2", offset: offset + 2, severity: "warning", title: "2 findings", count: 2 }]);
    const marker = editor.view.dom.querySelector<HTMLElement>("[data-scene-marker]");
    expect(marker?.textContent).toBe("2");
    expect(marker?.classList.contains("pl-scene-marker--warning")).toBe(true);
    expect(marker?.closest("p")?.textContent).toContain("* * *");

    editor.commands.insertContentAt(1, "Opening ");
    const [moved] = getSceneMarkers(editor.state);
    expect(editor.state.doc.resolve(moved!.pos).parent.textContent).toBe("* * *");

    editor.view.dom.querySelector("[data-scene-marker]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("ch1.s2");
    expect(docToText(editor.state.doc)).toBe(`Opening ${TEXT}`);

    editor.commands.setSceneMarkers([]);
    expect(editor.view.dom.querySelector("[data-scene-marker]")).toBeNull();
  });
});
