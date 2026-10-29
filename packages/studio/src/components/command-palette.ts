import type { HashRoute } from "../hooks/use-hash-route";
import type { TFunction } from "../hooks/use-i18n";

// The command palette's commands (PLAN, "Command palette": run any check, agent or
// export by name). Built from the route, so the open book's and chapter's commands
// come first; the palette filters them by title and keywords.

export type PaletteGroup = "book" | "run" | "export" | "go" | "books";

export interface PaletteCommand {
  readonly id: string;
  readonly group: PaletteGroup;
  readonly title: string;
  /** Extra words to match, such as the CLI name of the same command. */
  readonly keywords?: ReadonlyArray<string>;
  readonly run: () => void | Promise<void>;
}

export interface PaletteNav {
  toDashboard: () => void;
  toBook: (bookId: string) => void;
  toChapter: (bookId: string, chapter: number) => void;
  toAnalytics: (bookId: string) => void;
  toBoards: (bookId: string) => void;
  toPublish: (bookId: string) => void;
  toTruth: (bookId: string) => void;
  toBookSettings: (bookId: string) => void;
  toServices: () => void;
  toDoctor: () => void;
  toLogs: () => void;
  toStyle: () => void;
  toImport: () => void;
}

export interface PaletteActions {
  /** Ask the writer agent for the next chapter. */
  writeNext: (bookId: string) => void | Promise<void>;
  /** Run the auditor on one chapter and show what it found. */
  audit: (bookId: string, chapter: number) => void | Promise<void>;
  /** Start a file download. */
  download: (url: string) => void;
}

export interface PaletteInput {
  readonly route: HashRoute;
  readonly books: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly nav: PaletteNav;
  readonly actions: PaletteActions;
  readonly t: TFunction;
}

const exportUrl = (bookId: string, kind: "outline" | "provenance") => `/api/v1/plotlint/export/${encodeURIComponent(bookId)}/${kind}`;

/** A chapter number typed into the palette ("12", "ch12", "chapter 12"), or null. */
export function chapterQuery(query: string): number | null {
  const match = query.trim().match(/^(?:ch(?:apter)?\.?\s*|第\s*)?(\d{1,5})(?:\s*章)?$/iu);
  const chapter = match ? Number(match[1]) : NaN;
  return Number.isInteger(chapter) && chapter > 0 ? chapter : null;
}

export function paletteCommands({ route, books, nav, actions, t }: PaletteInput): PaletteCommand[] {
  const commands: PaletteCommand[] = [];
  const bookId = "bookId" in route ? route.bookId : undefined;
  const add = (command: PaletteCommand) => commands.push(command);

  if (bookId) {
    const title = books.find((book) => book.id === bookId)?.title ?? bookId;
    if (route.page === "chapter") {
      add({ id: "run:audit", group: "run", title: `${t("palette.audit")} ch${route.chapterNumber}`, keywords: ["review", "audit", "check", "审稿"], run: () => actions.audit(bookId, route.chapterNumber) });
    }
    add({ id: "run:write-next", group: "run", title: t("palette.writeNext"), keywords: ["write", "next", "agent", "inkos write next"], run: () => actions.writeNext(bookId) });
    add({ id: "go:book", group: "book", title: `${t("palette.openBook")}: ${title}`, keywords: ["chapters", "book"], run: () => nav.toBook(bookId) });
    add({ id: "go:boards", group: "book", title: t("palette.boards"), keywords: ["hooks", "timeline", "cast", "tension", "board"], run: () => nav.toBoards(bookId) });
    add({ id: "go:analytics", group: "book", title: t("palette.analytics"), keywords: ["metrics", "provenance", "stats"], run: () => nav.toAnalytics(bookId) });
    add({ id: "go:truth", group: "book", title: t("palette.truth"), keywords: ["story bible", "state", "truth files"], run: () => nav.toTruth(bookId) });
    add({ id: "go:branches", group: "book", title: t("palette.branches"), keywords: ["branch", "what if", "diff", "inkos lint branch"], run: () => nav.toPublish(bookId) });
    add({ id: "go:book-settings", group: "book", title: t("palette.bookSettings"), keywords: ["settings", "config"], run: () => nav.toBookSettings(bookId) });
    add({ id: "export:manuscript", group: "export", title: t("palette.manuscript"), keywords: ["docx", "submission", "export", "inkos lint export manuscript"], run: () => nav.toPublish(bookId) });
    add({ id: "export:outline", group: "export", title: t("palette.outline"), keywords: ["synopsis", "export", "md"], run: () => actions.download(exportUrl(bookId, "outline")) });
    add({ id: "export:provenance", group: "export", title: t("palette.provenance"), keywords: ["provenance", "report", "export", "ai"], run: () => actions.download(exportUrl(bookId, "provenance")) });
  }

  add({ id: "go:dashboard", group: "go", title: t("palette.dashboard"), keywords: ["home", "books"], run: nav.toDashboard });
  add({ id: "go:import", group: "go", title: t("palette.import"), keywords: ["import", "manuscript", "chapters"], run: nav.toImport });
  add({ id: "go:style", group: "go", title: t("palette.style"), keywords: ["style", "voice"], run: nav.toStyle });
  add({ id: "go:services", group: "go", title: t("palette.services"), keywords: ["model", "llm", "provider", "api key"], run: nav.toServices });
  add({ id: "go:doctor", group: "go", title: t("palette.doctor"), keywords: ["doctor", "health", "diagnose"], run: nav.toDoctor });
  add({ id: "go:logs", group: "go", title: t("palette.logs"), keywords: ["logs"], run: nav.toLogs });

  for (const book of books) {
    if (book.id === bookId) continue;
    add({ id: `books:${book.id}`, group: "books", title: book.title, keywords: [book.id], run: () => nav.toBook(book.id) });
  }
  return commands;
}
