import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { ChapterWorkspacePanel } from "../components/ChapterWorkspacePanel";
import { ManuscriptEditor, type ManuscriptEditorHandle } from "../components/plotlint/ManuscriptEditor";
import type { EvidenceLocation } from "../components/plotlint/navigate-client";
import {
  BookOpen,
  ChevronDown,
  Type,
  Clock,
  Pencil,
  Save,
  Eye,
  GitCompare,
  SlidersHorizontal,
} from "lucide-react";

interface ChapterData {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

interface PendingAgentEdit {
  readonly versionId: string;
  readonly source: string;
  readonly createdAt: string;
  readonly before: string;
}

interface TextRange {
  readonly start: number;
  readonly end: number;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
  /** Open a chapter, optionally in the editor with a text range selected. */
  toChapter?: (bookId: string, chapterNumber: number, select?: TextRange) => void;
}

export function ChapterReader({ bookId, chapterNumber, select, nav, theme, t, canLeaveRef }: {
  bookId: string;
  chapterNumber: number;
  /** Open in the editor with this range of the chapter file's text selected (a jump from another chapter). */
  select?: TextRange;
  nav: Nav;
  theme: Theme;
  t: TFunction;
  /** Set to a check the workspace runs before leaving this chapter: false if the writer chose to stay with unsaved edits. */
  canLeaveRef?: MutableRefObject<(() => boolean) | null>;
}) {
  useColors(theme);
  const { data, loading, error, refetch } = useApi<ChapterData>(
    `/books/${bookId}/chapters/${chapterNumber}`,
  );
  // The chapter opens in the editor: this is a word processor first, and the reading view is a preview.
  const [editing, setEditing] = useState(true);
  // The text the editor opened with (null: the chapter as loaded). The text being edited lives in
  // the editor; `editorRef` reads it back exactly for saving.
  const [editContent, setEditContent] = useState<string | null>(null);
  // Bumped to reopen the editor on the saved text, e.g. once a review of an agent's edit is done.
  const [editorRevision, setEditorRevision] = useState(0);
  const editorRef = useRef<ManuscriptEditorHandle>(null);
  const [saving, setSaving] = useState(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  // A jump here opens the editor once, on the passage it points at.
  const [pendingSelect, setPendingSelect] = useState(select);
  // An agent's edit not yet reviewed: the editor can show it as tracked changes against `before`.
  const review = useApi<{ pending: PendingAgentEdit | null }>(`/plotlint/review/${encodeURIComponent(bookId)}/${chapterNumber}`);
  const [reviewing, setReviewing] = useState<PendingAgentEdit | null>(null);
  const [openSuggestions, setOpenSuggestions] = useState(0);

  useEffect(() => {
    if (!pendingSelect || !data || editing) return;
    setEditContent(data.content);
    setEditing(true);
  }, [pendingSelect, data, editing]);

  const isDirty = () => Boolean(editing && data && editorRef.current && editorRef.current.getText() !== data.content);
  const confirmLeave = () => !isDirty() || window.confirm(t("state.leaveUnsaved"));

  useEffect(() => {
    if (!canLeaveRef) return;
    canLeaveRef.current = confirmLeave;
    return () => { canLeaveRef.current = null; };
  });

  // Closing or reloading the tab with unsaved edits asks first.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  });

  // Ctrl/Cmd+S saves, as in any editor.
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      saveRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Go to a passage in another chapter, after confirming that unsaved edits here may be left behind. */
  const openLocation = (location: EvidenceLocation) => {
    if (!nav.toChapter) return;
    if (!confirmLeave()) return;
    nav.toChapter(bookId, location.chapter, { start: location.start, end: location.end });
  };

  const handleStartEdit = () => {
    if (!data) return;
    setEditContent(data.content);
    setEditing(true);
  };

  const handleStartReview = () => {
    if (!data || !review.data?.pending) return;
    if (isDirty() && !window.confirm(t("reader.discardEdits"))) return;
    setEditContent(data.content);
    setReviewing(review.data.pending);
    setEditing(true);
    setEditorRevision((revision) => revision + 1);
  };

  const handleCancelEdit = () => {
    if (isDirty() && !window.confirm(t("reader.discardEdits"))) return;
    setPendingSelect(undefined);
    setEditing(false);
    setEditContent(null);
    setReviewing(null);
    setOpenSuggestions(0);
  };

  const handleSave = async () => {
    if (!editing || saving) return;
    if (reviewing && openSuggestions > 0 && !window.confirm(t("suggest.saveOpen"))) return;
    setSaving(true);
    try {
      const content = editorRef.current?.getText() ?? editContent ?? data?.content ?? "";
      // Keeping every change of a review leaves the file as the agent wrote it: nothing to save.
      if (!reviewing || content !== data?.content) {
        await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
      }
      if (reviewing) {
        await fetchJson(`/plotlint/review/${encodeURIComponent(bookId)}/${chapterNumber}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId: reviewing.versionId }),
        });
        setReviewing(null);
        setOpenSuggestions(0);
        void review.refetch();
        // Reopen on the saved text, without the tracked changes.
        setEditContent(content);
        setEditorRevision((revision) => revision + 1);
      }
      // Saving keeps the editor open where the writer is.
      setPendingSelect(undefined);
      refetch();
      setWorkspaceRevision((revision) => revision + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = () => { void handleSave(); };

  if (loading && !data) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">{t("reader.openingManuscript")}</span>
    </div>
  );

  if (error) return <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">Error: {error}</div>;
  if (!data) return null;

  // Split markdown content into title and body
  const lines = data.content.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = titleLine?.replace(/^#\s*/, "") ?? `Chapter ${chapterNumber}`;
  const body = lines
    .filter((l) => l !== titleLine)
    .join("\n")
    .trim();

  const paragraphs = body.split(/\n\n+/).filter(Boolean);

  return (
    <div className="w-full space-y-6 fade-in">
      {!reviewing && review.data?.pending && (
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4 md:flex-row md:items-center md:justify-between" data-testid="agent-edit-banner">
          <div className="text-sm">
            <span className="font-semibold">{t("suggest.banner")}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {review.data.pending.source} · {new Date(review.data.pending.createdAt).toLocaleString()}
            </span>
          </div>
          <button
            onClick={handleStartReview}
            className="flex items-center gap-2 self-start rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm transition-all hover:scale-105 active:scale-95 md:self-auto"
          >
            <GitCompare size={14} />
            {t("suggest.review")}
          </button>
        </div>
      )}

      {/* One row above the text: the chapter's tools, folded away until wanted, and save/preview. */}
      <div className="flex items-start gap-3">
        {/* The brief, rewrite and version tools. */}
        <details className="group min-w-0 flex-1 rounded-2xl border border-border/50 bg-card/50" data-testid="chapter-tools">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-xs font-bold text-muted-foreground hover:text-foreground">
            <SlidersHorizontal size={14} />
            {t("reader.chapterTools")}
            <ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-3 pb-3">
            <ChapterWorkspacePanel
              key={`${chapterNumber}-${workspaceRevision}`}
              bookId={bookId}
              chapterNumber={chapterNumber}
              t={t}
              onChapterChanged={() => { refetch(); void review.refetch(); }}
              onChapterDeleted={() => nav.toBook(bookId)}
            />
          </div>
        </details>
        <div className="flex shrink-0 gap-2">
          {/* Edit / Preview toggle */}
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-primary text-primary-foreground rounded-xl hover:scale-105 active:scale-95 transition-all shadow-sm disabled:opacity-50"
              >
                {saving ? <div className="w-3.5 h-3.5 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={14} />}
                {saving ? t("book.saving") : reviewing ? t("suggest.finish") : t("book.save")}
              </button>
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground transition-all border border-border/50"
              >
                <Eye size={14} />
                {t("reader.preview")}
              </button>
            </>
          ) : (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-primary hover:bg-primary/10 transition-all border border-border/50"
            >
              <Pencil size={14} />
              {t("reader.edit")}
            </button>
          )}

        </div>
      </div>

      {/* Manuscript Sheet */}
      {/* overflow-clip, not hidden: hidden makes a scroll container, which would stop the state panel sticking. */}
      <div className="paper-sheet rounded-2xl p-6 md:p-10 xl:p-14 shadow-2xl shadow-primary/5 min-h-[80vh] relative overflow-clip">
        {/* Physical Paper Details */}
        <div className="absolute top-0 left-8 w-px h-full bg-primary/5 hidden md:block" />
        <div className="absolute top-0 right-8 w-px h-full bg-primary/5 hidden md:block" />

        <header className={`${editing ? "mb-8" : "mb-16"} text-center`}>
          <div className={`${editing ? "hidden" : "flex"} items-center justify-center gap-2 text-muted-foreground/30 mb-8 select-none`}>
            <div className="h-px w-12 bg-border/40" />
            <BookOpen size={20} />
            <div className="h-px w-12 bg-border/40" />
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-medium italic text-foreground tracking-tight leading-tight">
            {title}
          </h1>
          <div className={`${editing ? "mt-3" : "mt-8"} flex items-center justify-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60`}>
            <span>{t("reader.manuscriptPage")}</span>
            <span className="text-border">·</span>
            <span>{chapterNumber.toString().padStart(2, '0')}</span>
          </div>
        </header>

        {editing ? (
          <ManuscriptEditor
            key={editorRevision}
            bookId={bookId}
            chapterNumber={chapterNumber}
            initialText={editContent ?? data.content}
            handleRef={editorRef}
            t={t}
            selection={pendingSelect}
            onOpenLocation={openLocation}
            {...(reviewing ? { suggestFrom: reviewing.before, onSuggestionsChange: setOpenSuggestions } : {})}
          />
        ) : (
          <article className="prose prose-zinc dark:prose-invert max-w-none">
            {paragraphs.map((para, i) => (
              <p key={i} className="font-serif text-lg md:text-xl leading-[1.8] text-foreground/90 mb-8 first-letter:text-2xl first-letter:font-bold first-letter:text-primary/40">
                {para}
              </p>
            ))}
          </article>
        )}

        <footer className="mt-24 pt-12 border-t border-border/20 flex flex-col items-center gap-6 text-center">
          <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Type size={14} className="text-primary/60" />
               <span>{body.length.toLocaleString()} {t("reader.characters")}</span>
             </div>
             <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/50">
               <Clock size={14} className="text-primary/60" />
               <span>{Math.ceil(body.length / 500)} {t("reader.minRead")}</span>
             </div>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-bold">{t("reader.endOfChapter")}</p>
        </footer>
      </div>

    </div>
  );
}
