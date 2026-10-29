import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "../../hooks/use-i18n";
import { chapterQuery, paletteCommands, type PaletteNav } from "../command-palette";

const t = ((key: string) => key) as TFunction;
const nav = (): PaletteNav => ({
  toDashboard: vi.fn(), toBook: vi.fn(), toChapter: vi.fn(), toAnalytics: vi.fn(), toBoards: vi.fn(), toPublish: vi.fn(),
  toTruth: vi.fn(), toBookSettings: vi.fn(), toServices: vi.fn(), toDoctor: vi.fn(), toLogs: vi.fn(), toStyle: vi.fn(), toImport: vi.fn(),
});
const books = [{ id: "fen", title: "The Fen" }, { id: "tide", title: "Tide" }];

describe("command palette", () => {
  it("puts the open chapter's checks and agents first, then the book's pages and exports", async () => {
    const actions = { writeNext: vi.fn(), audit: vi.fn(), download: vi.fn() };
    const n = nav();
    const commands = paletteCommands({ route: { page: "chapter", bookId: "fen", chapterNumber: 3 }, books, nav: n, actions, t });
    expect(commands.slice(0, 3).map((command) => command.id)).toEqual(["run:audit", "run:write-next", "go:book"]);
    expect(commands.find((command) => command.id === "run:audit")!.title).toBe("palette.audit ch3");
    await commands.find((command) => command.id === "run:audit")!.run();
    expect(actions.audit).toHaveBeenCalledWith("fen", 3);
    await commands.find((command) => command.id === "export:outline")!.run();
    expect(actions.download).toHaveBeenCalledWith("/api/v1/plotlint/export/fen/outline");
    await commands.find((command) => command.id === "go:boards")!.run();
    expect(n.toBoards).toHaveBeenCalledWith("fen");
    // The open book is not listed again among the other books.
    expect(commands.filter((command) => command.group === "books").map((command) => command.title)).toEqual(["Tide"]);
  });

  it("offers only project commands and books outside a book", () => {
    const commands = paletteCommands({ route: { page: "dashboard" }, books, nav: nav(), actions: { writeNext: vi.fn(), audit: vi.fn(), download: vi.fn() }, t });
    expect(commands.some((command) => command.group === "run" || command.group === "export")).toBe(false);
    expect(commands.filter((command) => command.group === "books")).toHaveLength(2);
  });

  it("reads a chapter number from the query", () => {
    expect(["12", "ch12", "Chapter 12", "ch. 12", "第12章"].map(chapterQuery)).toEqual([12, 12, 12, 12, 12]);
    expect(["0", "boards", "12a", ""].map(chapterQuery)).toEqual([null, null, null, null]);
  });
});
