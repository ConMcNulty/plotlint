import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, Download, LayoutGrid, MessageSquare, MoreHorizontal, NotebookText, PanelRightClose, Plus, Settings } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { useChatStore } from "../store/chat";
import { ChatPage } from "../pages/ChatPage";
import { ChapterReader } from "../pages/ChapterReader";
import { BookInfoPanel } from "./chat/BookSidebar";
import {
  SIDE_PANEL_STORAGE_KEY,
  chapterToOpen,
  initialSidePanel,
  neighbours,
  type SidePanelState,
  type SidePanelTab,
} from "./plotlint/workspace-model";

interface ChapterMeta {
  readonly number: number;
  readonly title: string;
}

interface BookData {
  readonly book: { readonly id: string; readonly title: string };
  readonly chapters: ReadonlyArray<ChapterMeta>;
}

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toServices: () => void;
  toFilm: (projectId: string) => void;
  toFilmStudio: (projectId: string) => void;
  toChapter: (bookId: string, chapterNumber: number, select?: { start: number; end: number }) => void;
  toBookSettings: (bookId: string) => void;
  toBoards: (bookId: string) => void;
  toPublish: (bookId: string) => void;
  toAnalytics: (bookId: string) => void;
}

const PANEL_MIN = 320;
const PANEL_MAX = 720;

function defaultPanelWidth(): number {
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.3)));
}

function savedPanel(): string | null {
  try {
    return window.localStorage.getItem(SIDE_PANEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * A book open for writing: the chapter's text in the centre, and the chat with
 * the author agent and the book's notes in one side panel the writer can close.
 */
export function BookWorkspace({ bookId, chapterNumber, select, nav, theme, t, sse }: {
  bookId: string;
  /** The chapter asked for; without one the book opens on its latest chapter. */
  chapterNumber?: number;
  select?: { start: number; end: number };
  nav: Nav;
  theme: Theme;
  t: TFunction;
  sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}) {
  const book = useApi<BookData>(`/books/${encodeURIComponent(bookId)}`);
  const chapters = book.data?.chapters ?? [];
  const current = book.data ? chapterToOpen(chapters, chapterNumber) : chapterNumber ?? null;
  const { previous, next } = current === null ? { previous: null, next: null } : neighbours(chapters, current);

  // A chapter the author agent finishes shows up in the chapter list.
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);
  const refetchBook = book.refetch;
  useEffect(() => {
    if (bookDataVersion > 0) void refetchBook();
  }, [bookDataVersion, refetchBook]);

  const [panel, setPanelState] = useState<SidePanelState | null>(null);
  useEffect(() => {
    if (panel === null && book.data) setPanelState(initialSidePanel(savedPanel(), book.data.chapters.length));
  }, [panel, book.data]);
  const setPanel = useCallback((next: SidePanelState) => {
    setPanelState(next);
    try {
      window.localStorage.setItem(SIDE_PANEL_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable (private windows); the choice then lasts until reload.
    }
  }, []);
  const togglePanel = (tab: SidePanelTab) => {
    setPanel(panel?.open && panel.tab === tab ? { open: false, tab } : { open: true, tab });
  };

  // A file the chat opens is shown in the notes tab.
  const sidebarView = useChatStore((s) => s.sidebarView);
  useEffect(() => {
    if (sidebarView === "artifact") setPanel({ open: true, tab: "book" });
  }, [sidebarView, setPanel]);

  // Once mounted, the chat stays mounted while hidden so a running turn and the draft survive a tab switch.
  const [chatMounted, setChatMounted] = useState(false);
  useEffect(() => {
    if (panel?.open && panel.tab === "chat") setChatMounted(true);
  }, [panel]);

  const canLeaveRef = useRef<(() => boolean) | null>(null);
  const openChapter = (number: number) => {
    if (number === current) return;
    if (canLeaveRef.current && !canLeaveRef.current()) return;
    nav.toChapter(bookId, number);
  };

  const [width, setWidth] = useState(defaultPanelWidth);
  const onResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (move: MouseEvent) => {
      setWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, startWidth + startX - move.clientX)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const chapterLabel = (chapter: ChapterMeta) =>
    chapter.title ? `${chapter.number}. ${chapter.title}` : t("bread.chapter").replace("{n}", String(chapter.number));
  const tabButton = (tab: SidePanelTab, label: string, Icon: typeof MessageSquare) => (
    <button
      type="button"
      onClick={() => togglePanel(tab)}
      aria-pressed={Boolean(panel?.open && panel.tab === tab)}
      data-testid={`workspace-toggle-${tab}`}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
        panel?.open && panel.tab === tab
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/50 text-muted-foreground hover:border-primary/40 hover:text-primary"
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );

  return (
    <div className="absolute inset-0 flex min-w-0" data-testid="book-workspace">
      <section className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar: which chapter, and the side panel's toggles. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-4 py-2">
          <span className="mr-2 hidden max-w-[220px] truncate font-serif text-sm font-semibold text-foreground md:inline">
            {book.data?.book.title ?? bookId}
          </span>
          {chapters.length > 0 && current !== null && (
            <>
              <button
                type="button"
                onClick={() => previous !== null && openChapter(previous)}
                disabled={previous === null}
                aria-label={t("workspace.previous")}
                title={t("workspace.previous")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <select
                value={current}
                onChange={(event) => openChapter(Number(event.target.value))}
                aria-label={t("chapter.label").replace("{n}", "")}
                data-testid="workspace-chapter-select"
                className="max-w-[280px] truncate rounded-lg border border-border/50 bg-card px-2 py-1.5 text-sm text-foreground"
              >
                {chapters.map((chapter) => (
                  <option key={chapter.number} value={chapter.number}>{chapterLabel(chapter)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => next !== null && openChapter(next)}
                disabled={next === null}
                aria-label={t("workspace.next")}
                title={t("workspace.next")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {tabButton("chat", t("workspace.chat"), MessageSquare)}
            {tabButton("book", t("workspace.book"), NotebookText)}
            {/* The book's other pages, one click away but out of sight. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t("workspace.more")}
                title={t("workspace.more")}
                data-testid="workspace-more"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
              >
                <MoreHorizontal size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => nav.toBoards(bookId)}><LayoutGrid size={14} /><span>{t("book.boards")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => nav.toPublish(bookId)}><Download size={14} /><span>{t("book.publish")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => nav.toAnalytics(bookId)}><BarChart3 size={14} /><span>{t("book.analytics")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => nav.toBookSettings(bookId)}><Settings size={14} /><span>{t("book.settings")}</span></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* The manuscript. */}
        <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
          {book.error && !current ? (
            <div className="m-8 rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-destructive">Error: {book.error}</div>
          ) : current !== null ? (
            <div className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10 2xl:px-12">
              {/* Keyed so another chapter opens a fresh reader (and editor) on it. */}
              <ChapterReader
                key={`${bookId}:${current}`}
                bookId={bookId}
                chapterNumber={current}
                {...(select && current === chapterNumber ? { select } : {})}
                nav={nav}
                theme={theme}
                t={t}
                canLeaveRef={canLeaveRef}
              />
            </div>
          ) : book.data ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center" data-testid="workspace-empty">
              <p className="font-serif text-2xl italic text-foreground">{t("workspace.noChapters")}</p>
              <p className="max-w-md text-sm leading-7 text-muted-foreground">{t("workspace.noChaptersHint")}</p>
              {!(panel?.open && panel.tab === "chat") && (
                <button
                  type="button"
                  onClick={() => setPanel({ open: true, tab: "chat" })}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm"
                >
                  <MessageSquare size={14} />
                  {t("workspace.openChat")}
                </button>
              )}
            </div>
          ) : (
            <div className="flex justify-center py-32">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            </div>
          )}
        </div>
      </section>

      {/* Side panel: chat or book notes. Inline on wide screens, over the text on narrow ones. */}
      {(panel?.open || chatMounted) && (
        <aside
          className={`${panel?.open ? "flex" : "hidden"} fixed inset-y-0 right-0 z-40 max-w-[90vw] flex-col border-l border-border/40 bg-background shadow-2xl lg:relative lg:z-auto lg:max-w-none lg:bg-background/30 lg:shadow-none lg:backdrop-blur-sm`}
          style={{ width }}
          data-testid="workspace-side-panel"
        >
          <div
            onMouseDown={onResizeStart}
            className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/20 active:bg-primary/30"
          />
          <div className="flex shrink-0 items-center gap-1 border-b border-border/40 px-3 py-2">
            {(["chat", "book"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setPanel({ open: true, tab })}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  panel?.tab === tab ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "chat" ? t("workspace.chat") : t("workspace.book")}
              </button>
            ))}
            <button
              type="button"
              onClick={() => panel && setPanel({ ...panel, open: false })}
              aria-label={t("workspace.closePanel")}
              title={t("workspace.closePanel")}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <PanelRightClose size={15} />
            </button>
          </div>
          {chatMounted && panel?.tab === "chat" && <ChatSessionPicker bookId={bookId} t={t} />}
          {chatMounted && (
            <div className={`${panel?.tab === "chat" ? "flex" : "hidden"} min-h-0 flex-1`}>
              <ChatPage activeBookId={bookId} mode="book" nav={nav} theme={theme} t={t} sse={sse} />
            </div>
          )}
          {panel?.tab === "book" && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <BookInfoPanel bookId={bookId} theme={theme} t={t} sse={sse} onOpenChapter={openChapter} />
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

/** The book's chats: pick an earlier one or start a new one. */
function ChatSessionPicker({ bookId, t }: { bookId: string; t: TFunction }) {
  const sessions = useChatStore((s) => s.sessions);
  const ids = useChatStore((s) => s.sessionIdsByBook[bookId]);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const loadSessionList = useChatStore((s) => s.loadSessionList);
  const loadSessionDetail = useChatStore((s) => s.loadSessionDetail);
  const activateSession = useChatStore((s) => s.activateSession);
  const createDraftSession = useChatStore((s) => s.createDraftSession);
  const setInput = useChatStore((s) => s.setInput);
  useEffect(() => {
    if (ids === undefined) void loadSessionList(bookId);
  }, [bookId, ids, loadSessionList]);

  const bookSessions = (ids ?? []).map((id) => sessions[id]).filter(Boolean);
  const label = (session: (typeof bookSessions)[number]) =>
    session.title
      ?? session.messages.find((message) => message.role === "user")?.content?.trim().replace(/\s+/g, " ")
      ?? t("workspace.newChat");

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-3 py-1.5">
      <select
        value={activeSessionId && bookSessions.some((session) => session.sessionId === activeSessionId) ? activeSessionId : ""}
        onChange={(event) => {
          setInput("");
          activateSession(event.target.value);
          void loadSessionDetail(event.target.value);
        }}
        aria-label={t("nav.history")}
        data-testid="workspace-chat-select"
        className="min-w-0 flex-1 truncate rounded-md border border-border/50 bg-card px-2 py-1 text-xs text-foreground"
      >
        {bookSessions.length === 0 && <option value="">{t("workspace.newChat")}</option>}
        {bookSessions.map((session) => (
          <option key={session.sessionId} value={session.sessionId}>{label(session)}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => { setInput(""); createDraftSession(bookId, "book"); }}
        aria-label={t("workspace.newChat")}
        title={t("workspace.newChat")}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
