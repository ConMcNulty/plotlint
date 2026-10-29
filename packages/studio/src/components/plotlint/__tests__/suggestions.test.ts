// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TFunction } from "../../../hooks/use-i18n";
import { ManuscriptEditor, type ManuscriptEditorHandle } from "../ManuscriptEditor";
import type { LintResponse } from "../lint-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const emptyRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= emptyRect;

const t = ((key: string) => key) as TFunction;
const BEFORE = "# Chapter 1\n\nMira walked to the pier.";
const AFTER = "# Chapter 1\n\nMira ran down to the old pier.";
const lint = async (): Promise<LintResponse> => ({ sourceId: "chapter:1", diagnostics: [], ranges: null, suppressed: 0, stateMissing: false });
const navigation = { stateAt: async (offset: number) => ({ chapter: 1, offset, entities: [], stateMissing: false }), definition: async () => null };

describe("agent edits as tracked changes", () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
  });

  it("shows the agent's changes against the old text, and rejects them back to it", async () => {
    const handle = createRef<ManuscriptEditorHandle>();
    const onSuggestionsChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(ManuscriptEditor, {
        bookId: "b", chapterNumber: 1, initialText: AFTER, t, handleRef: handle, lint, navigation, suggestFrom: BEFORE, onSuggestionsChange,
      }));
    });
    expect(container.querySelector("[data-testid=suggestions-bar]")!.textContent).toContain("2 suggest.open");
    expect(onSuggestionsChange).toHaveBeenLastCalledWith(2);
    expect(container.querySelector(".pl-suggestion-delete")!.textContent).toBe("walked ");
    expect(handle.current!.getText()).toBe(AFTER);

    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid=suggestions-reject-all]")!.click(); });
    expect(handle.current!.getText()).toBe(BEFORE);
    expect(container.querySelector("[data-testid=suggestions-bar]")).toBeNull();
    expect(onSuggestionsChange).toHaveBeenLastCalledWith(0);
  });
});
