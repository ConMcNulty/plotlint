import { useEffect, useState } from "react";
import { useApi } from "../hooks/use-api";
import { useNewSSEMessages, type SSEMessage } from "../hooks/use-sse";
import { applyBookCollectionEvent, shouldRefetchBookCollections, shouldRefetchDaemonStatus } from "../hooks/use-book-activity";
import type { TFunction } from "../hooks/use-i18n";
import { setProjectChatSessionId } from "../pages/chat-page-state";
import { useChatStore } from "../store/chat";
import type { ChatRequestedIntent } from "../store/chat/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Settings,
  Terminal,
  MessageSquare,
  Gamepad2,
  ScrollText,
  BookPlus,
  BookCopy,
  BookOpen,
  Feather,
  Wand2,
  FileInput,
  TrendingUp,
  Stethoscope,
  Zap,
  ChevronRight,
  MoreHorizontal,
  GitBranch,
  Clapperboard,
  Rows3,
  Film,
  Languages,
  SlidersHorizontal,
} from "lucide-react";
import { InkosLogo } from "./InkosLogo";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

interface Nav {
  toDashboard: () => void;
  toChat: () => void;
  toBook: (id: string) => void;
  toBookCreate: () => void;
  toServices: () => void;
  toProjectSettings: () => void;
  toDaemon: () => void;
  toLogs: () => void;
  toStyle: () => void;
  toTranslation: () => void;
  toImport: (tab?: "chapters" | "canon" | "fanfic" | "spinoff" | "imitation") => void;
  toRadar: () => void;
  toDoctor: () => void;
  toFilmStudio: (id: string) => void;
}

/**
 * The sidebar is the writer's shelf: their books, a button for a new one, and
 * everything else InkOS can do folded into two menus (other kinds of project,
 * and settings and tools). Chats live with each book, in its side panel.
 */
export function Sidebar({ nav, activePage, sse, t }: {
  nav: Nav;
  activePage: string;
  sse: { messages: ReadonlyArray<SSEMessage> };
  t: TFunction;
}) {
  const { data, refetch: refetchBooks, mutate: mutateBooks } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: filmsData, refetch: refetchFilms } = useApi<{ films: ReadonlyArray<{ projectId: string; title: string }> }>("/interactive-films");
  const { data: daemon, refetch: refetchDaemon } = useApi<{ running: boolean }>("/daemon");
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);
  const createDraftSession = useChatStore((s) => s.createDraftSession);
  const setInput = useChatStore((s) => s.setInput);
  const [myBooksExpanded, setMyBooksExpanded] = useState(true);
  const [filmsExpanded, setFilmsExpanded] = useState(true);

  const books = data?.books ?? [];
  const films = filmsData?.films ?? [];

  useNewSSEMessages(sse.messages, (recent) => {
    if (shouldRefetchBookCollections(recent)) {
      let appliedIncrementally = false;
      mutateBooks((current) => {
        const updatedBooks = applyBookCollectionEvent(current?.books ?? [], recent);
        if (!updatedBooks) return current;
        appliedIncrementally = true;
        return { books: updatedBooks };
      });
      if (appliedIncrementally) {
        return;
      }
      refetchBooks();
    }
    if (shouldRefetchDaemonStatus(recent)) {
      refetchDaemon();
    }
  });

  useEffect(() => {
    void refetchFilms();
  }, [bookDataVersion, refetchFilms]);

  const openBook = (bookId: string) => {
    setInput("");
    nav.toBook(bookId);
  };
  const handleCreateProjectChatSession = (proposalAction?: ChatRequestedIntent) => {
    const sessionId = createDraftSession(
      null,
      "chat",
      undefined,
      proposalAction ? { proposalAction } : undefined,
    );
    setProjectChatSessionId(sessionId);
    setInput("");
    nav.toChat();
  };
  const handleOpenBookCreate = () => {
    setInput("");
    nav.toBookCreate();
  };
  const launchProjectMode = (kind: "short" | "play" | "script" | "storyboard" | "interactive-film", playMode?: "guided" | "open") => {
    // Play mode (分支互动 = guided / 自由互动 = open) is now decided here at the
    // launcher, not via an in-chat button.
    const sessionId = createDraftSession(null, kind, playMode);
    setProjectChatSessionId(sessionId);
    setInput("");
    nav.toChat();
  };

  const menuButton = "w-full group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors outline-none cursor-pointer";

  return (
    <aside className="w-[260px] shrink-0 border-r border-border bg-background/80 backdrop-blur-md flex flex-col h-full overflow-hidden select-none">
      {/* Logo Area */}
      <div className="px-6 pt-8 pb-6">
        <button
          onClick={nav.toDashboard}
          className="group flex items-center gap-3 hover:opacity-80 transition-all duration-300"
        >
          <InkosLogo className="w-11 h-11 shrink-0 group-hover:scale-105 transition-transform" />
          <div className="flex flex-col">
            <span className="font-serif text-[27px] leading-none italic font-medium">InkOS</span>
            <span className="text-[13px] uppercase tracking-[0.22em] text-muted-foreground font-bold mt-1.5">Studio</span>
          </div>
        </button>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-6">
        <div className="flex items-center gap-1 px-1">
          <button
            type="button"
            onClick={handleOpenBookCreate}
            data-testid="sidebar-new-book"
            className={`flex flex-1 min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
              activePage === "book-create"
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-foreground hover:border-primary/40 hover:text-primary"
            }`}
          >
            <BookPlus size={16} className="shrink-0" />
            <span className="truncate">{t("nav.newBook")}</span>
          </button>
          {/* InkOS's other kinds of project, out of the way of the books. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("nav.createSection")}
              title={t("nav.createSection")}
              data-testid="sidebar-more-create"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
            >
              <MoreHorizontal size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("nav.createSection")}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => launchProjectMode("short")}><ScrollText size={14} /><span>{t("nav.createShort")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCreateProjectChatSession("fanfic_init")}><Feather size={14} /><span>{t("nav.createFanfic")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCreateProjectChatSession("spinoff_create")}><BookCopy size={14} /><span>{t("nav.createSpinoff")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCreateProjectChatSession("style_imitation")}><Wand2 size={14} /><span>{t("nav.createImitation")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCreateProjectChatSession("continuation_import")}><FileInput size={14} /><span>{t("nav.createContinuation")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCreateProjectChatSession("translation_create")}><Languages size={14} /><span>{t("nav.createTranslation")}</span></DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => launchProjectMode("script")}><Clapperboard size={14} /><span>{t("nav.createScript")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => launchProjectMode("storyboard")}><Rows3 size={14} /><span>{t("nav.createStoryboard")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => launchProjectMode("interactive-film")}><Film size={14} /><span>{t("nav.createInteractiveFilm")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => launchProjectMode("play", "guided")}><GitBranch size={14} /><span>{t("nav.createBranching")}</span></DropdownMenuItem>
                <DropdownMenuItem onClick={() => launchProjectMode("play", "open")}><Gamepad2 size={14} /><span>{t("nav.createFree")}</span></DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={nav.toChat}><MessageSquare size={14} /><span>{t("nav.history")}</span></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* My books: opening one opens its manuscript. */}
        <div>
          <SectionHeader label={t("nav.myBooks")} expanded={myBooksExpanded} onToggle={() => setMyBooksExpanded((v) => !v)} />
          <Collapse open={myBooksExpanded}>
            <div className="space-y-0.5 pt-1">
              {books.map((book) => {
                const isActiveBook = activePage === `book:${book.id}`;
                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => openBook(book.id)}
                    className={`w-full flex min-w-0 items-center gap-2 px-3 py-1.5 rounded-md text-[15px] leading-6 transition-colors ${
                      isActiveBook ? "bg-secondary/60 text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                    }`}
                  >
                    <BookOpen size={14} className="shrink-0 text-muted-foreground/60" />
                    <span className="truncate flex-1 text-left">{book.title}</span>
                    {book.chaptersWritten > 0 && (
                      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/50">{book.chaptersWritten}</span>
                    )}
                  </button>
                );
              })}
              {books.length === 0 && (
                <div className="px-3 py-6 text-xs text-muted-foreground/50 italic text-center">
                  {t("dash.noBooks")}
                </div>
              )}
            </div>
          </Collapse>
        </div>

        {/* Interactive films, only once there are some. */}
        {films.length > 0 && (
          <div data-testid="film-projects-section">
            <SectionHeader label={t("nav.createInteractiveFilm")} expanded={filmsExpanded} onToggle={() => setFilmsExpanded((v) => !v)} />
            <Collapse open={filmsExpanded}>
              <div className="space-y-0.5 pt-1">
                {films.map((film) => (
                  <button
                    key={film.projectId}
                    type="button"
                    data-testid={`film-project-${film.projectId}`}
                    onClick={() => nav.toFilmStudio(film.projectId)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left hover:bg-secondary/30 transition-colors"
                  >
                    <Film size={14} className="shrink-0 text-muted-foreground" />
                    <span className="truncate text-[15px] text-foreground">{film.title}</span>
                  </button>
                ))}
              </div>
            </Collapse>
          </div>
        )}
      </div>

      {/* Settings and tools, folded into one menu. */}
      <div className="px-4 py-3 border-t border-border/60">
        <DropdownMenu>
          <DropdownMenuTrigger className={menuButton} data-testid="sidebar-settings-menu">
            <SlidersHorizontal size={16} />
            <span className="flex-1 text-left">{t("nav.settingsAndTools")}</span>
            <ChevronRight size={14} className="text-muted-foreground/50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("nav.system")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={nav.toServices}><Settings size={14} /><span>{t("nav.config")}</span></DropdownMenuItem>
              <DropdownMenuItem onClick={nav.toProjectSettings}><Settings size={14} /><span>{t("nav.projectSettings")}</span></DropdownMenuItem>
              <DropdownMenuItem onClick={nav.toDaemon}>
                <Zap size={14} />
                <span className="flex-1">{t("nav.daemon")}</span>
                {daemon?.running && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase bg-emerald-500/10 text-emerald-500">{t("nav.running")}</span>}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={nav.toLogs}><Terminal size={14} /><span>{t("nav.logs")}</span></DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("nav.tools")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => nav.toImport()}><FileInput size={14} /><span>{t("nav.import")}</span></DropdownMenuItem>
              <DropdownMenuItem onClick={nav.toStyle}><Wand2 size={14} /><span>{t("nav.style")}</span></DropdownMenuItem>
              <DropdownMenuItem onClick={nav.toTranslation}><Languages size={14} /><span>{t("nav.translation")}</span></DropdownMenuItem>
              <DropdownMenuItem onClick={nav.toRadar}><TrendingUp size={14} /><span>{t("nav.radar")}</span></DropdownMenuItem>
              <DropdownMenuItem onClick={nav.toDoctor}><Stethoscope size={14} /><span>{t("nav.doctor")}</span></DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Footer / Status Area — only show when agent is online */}
      {daemon?.running && (
        <div className="p-4 border-t border-border bg-secondary/40">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border shadow-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider">
              {t("nav.agentOnline")}
            </span>
          </div>
        </div>
      )}

    </aside>
  );
}

// Smooth collapse via grid-template-rows 0fr→1fr (content-height-agnostic, no JS measuring).
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

function SectionHeader({ label, expanded, onToggle }: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-full items-center gap-1.5 px-3 py-2 text-left"
    >
      <span className="flex-1 text-[16px] leading-6 uppercase tracking-[0.1em] text-muted-foreground font-bold group-hover:text-foreground transition-colors">
        {label}
      </span>
      <ChevronRight
        size={15}
        className={`text-muted-foreground/50 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
      />
    </button>
  );
}
