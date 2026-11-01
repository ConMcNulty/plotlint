import { useState, useEffect, useCallback, useRef } from "react";
import type { Theme } from "../../hooks/use-theme";
import type { TFunction } from "../../hooks/use-i18n";
import type { SSEMessage } from "../../hooks/use-sse";
import { useChatStore } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { ArrowLeft, Loader2, Pencil, Save, X } from "lucide-react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { ProgressSection } from "../sidebar/ProgressSection";
import { FoundationSection } from "../sidebar/FoundationSection";
import { SummarySection } from "../sidebar/SummarySection";
import { ChaptersSection } from "../sidebar/ChaptersSection";
import { CharacterSection } from "../sidebar/CharacterSection";
import { PendingHooksView } from "../sidebar/PendingHooksView";
import { ManuscriptEditor, type ManuscriptEditorHandle } from "../plotlint/ManuscriptEditor";
import {
  FOUNDATION_FILE_LABELS,
  presentCurrentState,
  roleFromPath,
} from "../../lib/truth-display";
import { tr } from "../../lib/app-language";

export interface BookSidebarProps {
  readonly bookId: string;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
  /** Open a chapter in the editor instead of previewing it here. */
  readonly onOpenChapter?: (chapterNumber: number) => void;
}

const streamdownPlugins = { cjk };

// Friendly header label for an opened truth file: character files show the
// character's name, foundation files their friendly label, everything else its
// path as a last resort.
function artifactLabel(file: string): string {
  return roleFromPath(file)?.name ?? FOUNDATION_FILE_LABELS[file] ?? file;
}

// Read-mode body for an opened file. A few files need reader-friendly handling
// instead of raw markdown: pending_hooks.md (a wide tracking table) renders as
// cards and current_state.md gets a reader-facing empty state.
function renderTruthBody(
  file: string | null,
  content: string,
) {
  if (file === "pending_hooks.md") {
    return <PendingHooksView content={content} />;
  }
  if (file === "current_state.md") {
    const { isEmpty, body: stateBody } = presentCurrentState(content);
    return isEmpty ? (
      <p className="text-[14px] leading-6 text-muted-foreground/60 italic">
        {tr("还没有运行状态。开始写作后，每写完一章这里会自动记录最新的故事进展。", "No runtime state yet. Once you start writing, the latest story progress is recorded here after each chapter.")}
      </p>
    ) : (
      <Streamdown plugins={streamdownPlugins} mode="static">{stateBody}</Streamdown>
    );
  }
  return <Streamdown plugins={streamdownPlugins} mode="static">{content}</Streamdown>;
}

function ArtifactView({ bookId, t }: { readonly bookId: string; readonly t: TFunction }) {
  const artifactFile = useChatStore((s) => s.artifactFile);
  const artifactChapter = useChatStore((s) => s.artifactChapter);
  const closeArtifact = useChatStore((s) => s.closeArtifact);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  // A chapter is edited in plotlint's manuscript editor; this reads its text back for saving.
  const editorRef = useRef<ManuscriptEditorHandle>(null);

  const isChapter = artifactChapter !== null;
  const label = isChapter
    ? tr(`第 ${artifactChapter} 章`, `Chapter ${artifactChapter}`)
    : artifactFile ? artifactLabel(artifactFile) : "";

  useEffect(() => {
    setEditing(false);
    setLoading(true);
    if (isChapter) {
      fetchJson<{ content: string }>(`/books/${bookId}/chapters/${artifactChapter}`)
        .then((data) => setContent(data.content ?? ""))
        .catch(() => setContent(null))
        .finally(() => setLoading(false));
    } else if (artifactFile) {
      fetchJson<{ content: string | null }>(
        `/books/${bookId}/truth/${artifactFile}`,
      )
        .then((data) => {
          setContent(data.content ?? "");
        })
        .catch(() => setContent(null))
        .finally(() => setLoading(false));
    }
  }, [bookId, artifactFile, artifactChapter, isChapter]);

  const handleEdit = useCallback(() => {
    setEditContent(content ?? "");
    setEditing(true);
  }, [content]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const text = isChapter ? editorRef.current?.getText() ?? editContent : editContent;
    try {
      if (isChapter) {
        await fetchJson(`/books/${bookId}/chapters/${artifactChapter}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });
      } else if (artifactFile) {
        await fetchJson(`/books/${bookId}/truth/${artifactFile}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: editContent }),
        });
      }
      setContent(text);
      setEditing(false);
    } catch {
      // keep editing state on error
    } finally {
      setSaving(false);
    }
  }, [bookId, artifactFile, artifactChapter, isChapter, editContent]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/20 shrink-0">
        <button
          onClick={closeArtifact}
          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-[15px] leading-6 font-medium truncate flex-1">{label}</span>
        {!loading && content !== null && !editing && (
          <button
            onClick={handleEdit}
            className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          >
            <Pencil size={12} />
          </button>
        )}
        {editing && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-6 h-6 rounded-md flex items-center justify-center text-emerald-500 hover:bg-emerald-500/10 transition-colors"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="text-muted-foreground animate-spin" />
          </div>
        ) : content === null ? (
          <p className="text-[14px] leading-6 text-muted-foreground/50 italic px-4 py-3">{tr("文件不存在", "File not found")}</p>
        ) : editing && isChapter ? (
          <ManuscriptEditor
            bookId={bookId}
            chapterNumber={artifactChapter}
            initialText={editContent}
            handleRef={editorRef}
            t={t}
            className="px-4 py-3 text-[15px]"
          />
        ) : editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-full min-h-[300px] bg-transparent text-[15px] leading-7 px-4 py-3 resize-none outline-none border-0 font-mono"
          />
        ) : (
          <div className="px-4 py-3 text-[15px] leading-7">
            {renderTruthBody(isChapter ? null : artifactFile, content)}
          </div>
        )}
      </div>
    </div>
  );
}

function PanelView({ bookId, theme: _theme, t, sse, onOpenChapter }: BookSidebarProps) {
  const isZh = t("nav.connected") === "\u5DF2\u8FDE\u63A5";

  // Show writing indicator only during pipeline operations (write/audit/revise)
  const [activeOp, setActiveOp] = useState<string | null>(null);
  useEffect(() => {
    const latest = sse.messages;
    if (latest.length === 0) return;
    const last = latest[latest.length - 1];
    if (last.event === "write:start") setActiveOp("write");
    else if (last.event === "tool:start") {
      const data = last.data as { tool?: string } | null;
      const action = data?.tool?.split("__").at(-1);
      if (action === "write_chapters") setActiveOp("write");
      else if (action === "review_chapter") setActiveOp("audit");
      else if (action === "revise_chapter") setActiveOp("revise");
    } else if (last.event === "write:complete" || last.event === "tool:end") {
      setActiveOp(null);
    }
  }, [sse.messages]);

  const OP_LABELS: Record<string, string> = {
    write: isZh ? "正在写作中..." : "Writing...",
    audit: isZh ? "正在审计中..." : "Auditing...",
    revise: isZh ? "正在修订中..." : "Revising...",
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      {activeOp && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10">
          <Loader2 size={12} className="text-primary animate-spin shrink-0" />
          <span className="text-[14px] leading-5 text-primary font-medium">
            {OP_LABELS[activeOp] ?? activeOp}
          </span>
        </div>
      )}
      <ProgressSection sse={sse} />
      <ChaptersSection bookId={bookId} isZh={isZh} {...(onOpenChapter ? { onOpenChapter } : {})} />
      <CharacterSection bookId={bookId} />
      <FoundationSection bookId={bookId} />
      <SummarySection bookId={bookId} />
    </div>
  );
}

/** The book's notes (progress, chapters, cast, foundation) or an opened file, for the workspace side panel. */
export function BookInfoPanel(props: BookSidebarProps) {
  const sidebarView = useChatStore((s) => s.sidebarView);
  return sidebarView === "artifact"
    ? <ArtifactView bookId={props.bookId} t={props.t} />
    : <PanelView {...props} />;
}
