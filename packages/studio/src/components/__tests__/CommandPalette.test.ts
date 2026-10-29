// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TFunction } from "../../hooks/use-i18n";
import { CommandPalette } from "../CommandPalette";
import type { PaletteNav } from "../command-palette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// cmdk scrolls the active item into view and measures with ResizeObserver; jsdom has neither.
Element.prototype.scrollIntoView ??= () => {};
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const t = ((key: string) => key) as TFunction;

describe("CommandPalette", () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("opens on Ctrl+K and runs the chosen command", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ books: [{ id: "fen", title: "The Fen" }] }), { headers: { "Content-Type": "application/json" } })));
    const nav = {
      toDashboard: vi.fn(), toBook: vi.fn(), toChapter: vi.fn(), toAnalytics: vi.fn(), toBoards: vi.fn(), toPublish: vi.fn(),
      toTruth: vi.fn(), toBookSettings: vi.fn(), toServices: vi.fn(), toDoctor: vi.fn(), toLogs: vi.fn(), toStyle: vi.fn(), toImport: vi.fn(),
    } satisfies PaletteNav;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root!.render(React.createElement(CommandPalette, { route: { page: "book", bookId: "fen" }, nav, t })); });
    expect(document.querySelector("[cmdk-root]")).toBeNull();

    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })); });
    const items = [...document.querySelectorAll("[cmdk-item]")].map((item) => item.textContent);
    expect(items).toContain("palette.boards");
    expect(items).toContain("palette.openBook: The Fen");

    const boards = [...document.querySelectorAll<HTMLElement>("[cmdk-item]")].find((item) => item.textContent === "palette.boards")!;
    await act(async () => { boards.click(); });
    expect(nav.toBoards).toHaveBeenCalledWith("fen");
    expect(document.querySelector("[cmdk-root]")).toBeNull();
  });
});
