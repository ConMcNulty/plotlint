// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CurrentStateFact } from "@actalk/inkos-core";
import type { TFunction } from "../../../hooks/use-i18n";
import { ManuscriptEditor, type ManuscriptEditorHandle, type NavigationClient } from "../ManuscriptEditor";
import type { LintResponse } from "../lint-client";
import type { Definition, EntityAtCursor, EvidenceLocation } from "../navigate-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout; ProseMirror measures ranges when it scrolls a selection into view.
const emptyRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= emptyRect;

const t = ((key: string) => key) as TFunction;

const TEXT = "# Chapter 2\n\nMira Vale climbed to the lantern house.\n\nHarrow lay dead at the foot of the stair.";
const span = (chapter: number, quote: string, text = TEXT): EvidenceLocation => {
  const start = text.indexOf(quote);
  return { chapter, start, end: start + quote.length, quote };
};
const fact = (subject: string, predicate: string, object: string, from: number): CurrentStateFact =>
  ({ subject, predicate, object, validFromChapter: from, validUntilChapter: null, sourceChapter: from });

const ENTITIES: EntityAtCursor[] = [
  { subject: "Harrow", facts: [{ fact: fact("Harrow", "mood", "grim", 2), kind: "trait", unanchored: true }] },
  {
    subject: "Mira Vale",
    facts: [
      { fact: fact("Mira Vale", "location", "lantern house", 2), kind: "location", established: span(2, "climbed to the lantern house") },
      { fact: fact("Mira Vale", "holds", "brass key", 1), kind: "possession", established: { chapter: 1, start: 40, end: 60, quote: "the brass key" } },
      { fact: fact("Mira Vale", "age", "30", 1), kind: "age" },
    ],
  },
];

const lint = async (): Promise<LintResponse> => ({ sourceId: "chapter:2", diagnostics: [], ranges: null, suppressed: 0, stateMissing: false });

describe("state panel and go to definition", () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
  });

  async function mount(navigation: NavigationClient, onOpenLocation = vi.fn()) {
    const handle = createRef<ManuscriptEditorHandle>();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(ManuscriptEditor, {
        bookId: "b", chapterNumber: 2, initialText: TEXT, t, handleRef: handle, lint, navigation, onOpenLocation,
      }));
    });
    return { container, handle, onOpenLocation };
  }
  const selected = (handle: React.RefObject<ManuscriptEditorHandle | null>) => {
    const { state } = handle.current!.editor()!;
    return state.doc.textBetween(state.selection.from, state.selection.to);
  };
  const pressF12 = (handle: React.RefObject<ManuscriptEditorHandle | null>) =>
    handle.current!.editor()!.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", bubbles: true }));

  it("shows the facts at the cursor and jumps to where each was established", async () => {
    const stateAt = vi.fn(async (offset: number) => ({ chapter: 2, offset, entities: ENTITIES, stateMissing: false }));
    const { container, handle, onOpenLocation } = await mount({ stateAt, definition: vi.fn() });
    await act(async () => { await vi.waitFor(() => expect(container.querySelector("[data-entity='Mira Vale']")).not.toBeNull()); });

    expect(stateAt).toHaveBeenCalledWith(expect.any(Number), TEXT);
    const mira = container.querySelector("[data-entity='Mira Vale']")!;
    expect([...mira.querySelectorAll("li")].map((li) => li.getAttribute("data-kind"))).toEqual(["location", "possession", "age"]);
    expect(mira.textContent).toContain("location→lantern house");
    expect(container.querySelectorAll("[data-testid=state-unanchored]")).toHaveLength(1);

    const links = mira.querySelectorAll<HTMLButtonElement>("[data-testid=state-established]");
    expect([...links].map((link) => link.textContent)).toEqual(["state.established ch2", "state.established ch1"]);
    // Same chapter: select the passage in place.
    await act(async () => { links[0]!.click(); });
    expect(selected(handle)).toBe("climbed to the lantern house");
    expect(onOpenLocation).not.toHaveBeenCalled();
    // Another chapter: hand the location to the reader.
    await act(async () => { links[1]!.click(); });
    expect(onOpenLocation).toHaveBeenCalledWith(expect.objectContaining({ chapter: 1, start: 40, end: 60 }));
  });

  it("asks again when the cursor moves, and hides with the toggle", async () => {
    const stateAt = vi.fn(async (offset: number) => ({ chapter: 2, offset, entities: [], stateMissing: false }));
    const { container, handle } = await mount({ stateAt, definition: vi.fn() });
    await act(async () => { await vi.waitFor(() => expect(stateAt).toHaveBeenCalledTimes(1)); });
    expect(container.querySelector("[data-testid=state-panel]")!.textContent).toContain("state.none");

    await act(async () => { handle.current!.revealRange({ start: 20, end: 20 }); });
    await act(async () => { await vi.waitFor(() => expect(stateAt).toHaveBeenCalledTimes(2)); });
    expect(stateAt).toHaveBeenLastCalledWith(20, TEXT);

    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid=state-toggle]")!.click(); });
    expect(container.querySelector("[data-testid=state-panel]")).toBeNull();
  });

  it("goes to the first definition of the name at the cursor on F12", async () => {
    const harrow = span(2, "Harrow lay dead");
    const definition = vi.fn(async (names: ReadonlyArray<string>) => names.includes("Harrow")
      ? { name: "Harrow", definitions: [{ entity: "Harrow", role: "subject", fact: fact("Harrow", "status", "dead", 2), location: harrow } as Definition] }
      : null);
    const stateAt = vi.fn(async (offset: number) => ({ chapter: 2, offset, entities: [], stateMissing: false }));
    const { container, handle } = await mount({ stateAt, definition });

    // Cursor inside "Vale": the name grows to "Mira Vale", which has no definition here.
    const vale = TEXT.indexOf("Vale") + 2;
    await act(async () => { handle.current!.revealRange({ start: vale, end: vale }); });
    await act(async () => { pressF12(handle); });
    await act(async () => { await vi.waitFor(() => expect(container.ownerDocument.querySelector("[data-testid=goto-notice]")).not.toBeNull()); });
    expect(definition).toHaveBeenLastCalledWith(["Mira Vale", "Vale"], TEXT);
    expect(document.querySelector("[data-testid=goto-notice]")!.textContent).toContain("state.noDefinition: Mira Vale");

    // Select "Harrow" and look it up.
    const at = TEXT.indexOf("Harrow");
    await act(async () => { handle.current!.revealRange({ start: at, end: at + 6 }); });
    await act(async () => { pressF12(handle); });
    await act(async () => { await vi.waitFor(() => expect(selected(handle)).toBe("Harrow lay dead")); });
    expect(definition).toHaveBeenLastCalledWith(["Harrow"], TEXT);
  });

  it("lists every reference to the name at the cursor on Shift+F12 and opens each", async () => {
    const at = TEXT.indexOf("Mira");
    const references = vi.fn(async () => ({
      entity: "Mira Vale", names: ["Mira Vale", "Mira", "Vale"], total: 2,
      groups: [
        { chapter: 1, hits: [{ start: 5, end: 9, text: "Mira", line: 3, context: "Mira at the pier." }] },
        { chapter: 2, hits: [{ start: at, end: at + 9, text: "Mira Vale", line: 3, context: "Mira Vale climbed to the lantern house." }] },
      ],
    }));
    const stateAt = vi.fn(async (offset: number) => ({ chapter: 2, offset, entities: [], stateMissing: false }));
    const { container, handle, onOpenLocation } = await mount({ stateAt, definition: vi.fn(), references });

    await act(async () => { handle.current!.revealRange({ start: at + 1, end: at + 1 }); });
    await act(async () => {
      handle.current!.editor()!.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", shiftKey: true, bubbles: true }));
    });
    await act(async () => { await vi.waitFor(() => expect(container.querySelector("[data-testid=references-panel]")).not.toBeNull()); });
    expect(references).toHaveBeenCalledWith(["Mira Vale", "Mira"], TEXT);
    const hits = container.querySelectorAll<HTMLButtonElement>("[data-testid=reference-hit]");
    expect(hits).toHaveLength(2);
    await act(async () => { hits[1]!.click(); });
    expect(selected(handle)).toBe("Mira Vale");
    await act(async () => { hits[0]!.click(); });
    expect(onOpenLocation).toHaveBeenCalledWith({ chapter: 1, start: 5, end: 9, quote: "Mira" });
  });
});
