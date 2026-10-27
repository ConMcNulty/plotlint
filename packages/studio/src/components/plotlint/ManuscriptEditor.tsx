import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { EyeOff, Wrench } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { confidenceLabel, type DiagnosticEntry } from "@plotlint/editor";
import "@plotlint/editor/styles.css";
import "./plotlint.css";
import type { TFunction } from "../../hooks/use-i18n";
import { cn } from "../../lib/utils";
import { createChapterEditor, type ChapterEditor, type ProblemsSnapshot } from "./chapter-editor";
import { chapterLinter, chapterSourceId, suppressDiagnostic, type LintDiagnostic, type LintFunction } from "./lint-client";
import { ProblemsPanel } from "./ProblemsPanel";
import { problemRows, type ProblemRow } from "./problems-model";

export interface ManuscriptEditorHandle {
  /** The chapter text as edited, exactly as it will be saved. */
  getText(): string;
  /** The underlying Tiptap editor, once mounted. */
  editor(): Editor | null;
}

export interface ManuscriptEditorProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  /** Text to open with; later changes to this prop are ignored until the editor remounts. */
  readonly initialText: string;
  readonly t: TFunction;
  readonly handleRef?: Ref<ManuscriptEditorHandle>;
  /** Override the lint route (tests). */
  readonly lint?: LintFunction;
  readonly className?: string;
}

interface HoverState {
  readonly entries: DiagnosticEntry[];
  readonly left: number;
  /** The underlined word's top and bottom, in viewport coordinates. */
  readonly anchorTop: number;
  readonly anchorBottom: number;
}

const EMPTY: ProblemsSnapshot = { ranged: [], unranged: [], suppressed: 0, linting: true, error: null, stateMissing: false };

/** The Tiptap chapter editor with plotlint squiggles, a hover card per finding, and the problems panel below. */
export function ManuscriptEditor({ bookId, chapterNumber, initialText, t, handleRef, lint, className }: ManuscriptEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ChapterEditor | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialTextRef = useRef(initialText);
  const [problems, setProblems] = useState<ProblemsSnapshot>(EMPTY);
  const [hover, setHover] = useState<HoverState | null>(null);

  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = undefined;
  };
  const hideSoon = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => setHover(null), 250);
  };

  useEffect(() => {
    const element = mountRef.current;
    if (!element) return;
    const controller = createChapterEditor({
      element,
      text: initialTextRef.current,
      sourceId: chapterSourceId(chapterNumber),
      lint: lint ?? chapterLinter(bookId, chapterNumber),
      editorClass: "pl-manuscript-editor font-serif text-lg leading-[1.8] text-foreground/90",
      onProblems: setProblems,
      onHover: (entries, context) => {
        if (entries.length === 0 || !context.anchor) {
          hideSoon();
          return;
        }
        cancelHide();
        const rect = context.anchor.getBoundingClientRect();
        setHover({ entries, left: rect.left, anchorTop: rect.top, anchorBottom: rect.bottom });
      },
    });
    controllerRef.current = controller;
    setProblems(controller.problems());
    return () => {
      cancelHide();
      controller.destroy();
      controllerRef.current = null;
    };
    // The editor is created once per chapter; text edits live inside it.
  }, [bookId, chapterNumber, lint]);

  // The card is fixed to where the word was; close it when the page scrolls.
  useEffect(() => {
    if (!hover) return;
    const close = () => setHover(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [hover]);

  useImperativeHandle(handleRef, () => ({
    getText: () => controllerRef.current?.getText() ?? initialTextRef.current,
    editor: () => controllerRef.current?.editor ?? null,
  }), []);

  const markIntentional = useCallback(async (diagnostic: LintDiagnostic) => {
    const reason = window.prompt(t("problems.reasonPrompt"))?.trim();
    if (!reason) return;
    try {
      await suppressDiagnostic(bookId, diagnostic, reason);
      setHover(null);
      await controllerRef.current?.relintAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }, [bookId, t]);

  const applyFix = (entry: DiagnosticEntry, index: number) => {
    controllerRef.current?.applyFix(entry.id, index);
    setHover(null);
  };

  const rows = useMemo(() => {
    const doc = controllerRef.current?.editor.state.doc;
    const lineOf = (pos: number) => (doc ? doc.resolve(Math.min(pos, doc.content.size)).index(0) + 1 : 0);
    return problemRows(problems.ranged, problems.unranged, lineOf);
  }, [problems]);

  const reveal = (row: ProblemRow) => {
    if (row.entryId) controllerRef.current?.reveal(row.entryId);
  };

  return (
    <div className={cn("space-y-6", className)}>
      <div ref={mountRef} className="pl-manuscript" data-testid="manuscript-editor" />
      <ProblemsPanel
        rows={rows}
        suppressed={problems.suppressed}
        linting={problems.linting}
        error={problems.error}
        stateMissing={problems.stateMissing}
        t={t}
        onSelect={reveal}
        onSuppress={(row) => void markIntentional(row.diagnostic)}
      />
      {/* Portalled: Studio's page containers animate with transforms, which would re-anchor a fixed card. */}
      {hover && typeof document !== "undefined" && createPortal(
        <DiagnosticCard
          hover={hover}
          t={t}
          onEnter={cancelHide}
          onLeave={hideSoon}
          onFix={applyFix}
          onSuppress={(entry) => void markIntentional(entry.diagnostic as LintDiagnostic)}
        />,
        document.body,
      )}
    </div>
  );
}

function DiagnosticCard({ hover, t, onEnter, onLeave, onFix, onSuppress }: {
  readonly hover: HoverState;
  readonly t: TFunction;
  readonly onEnter: () => void;
  readonly onLeave: () => void;
  readonly onFix: (entry: DiagnosticEntry, index: number) => void;
  readonly onSuppress: (entry: DiagnosticEntry) => void;
}) {
  const left = Math.max(8, Math.min(hover.left, (typeof window === "undefined" ? 1024 : window.innerWidth) - 400));
  // The card opens below the word, or above it when the word is near the bottom of the window.
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const vertical = hover.anchorBottom + 280 > viewportHeight
    ? { bottom: viewportHeight - hover.anchorTop + 6 }
    : { top: hover.anchorBottom + 6 };
  return (
    <div
      role="tooltip"
      data-testid="diagnostic-card"
      className="fixed z-50 w-[24rem] max-w-[calc(100vw-1rem)] space-y-3 rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-xl"
      style={{ left, ...vertical }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {hover.entries.map((entry) => {
        const { diagnostic } = entry;
        return (
          <section key={entry.id} className="space-y-1.5 [&+&]:border-t [&+&]:border-border/50 [&+&]:pt-3">
            <header className="flex flex-wrap items-baseline gap-2">
              <span className={cn("text-xs font-semibold capitalize", diagnostic.severity === "error" ? "text-destructive" : "text-foreground")}>{diagnostic.severity}</span>
              <code className="text-[11px] text-muted-foreground">{diagnostic.ruleId}</code>
              <span className="text-[11px] text-muted-foreground/80">{confidenceLabel(diagnostic.confidence)}</span>
            </header>
            <p className="text-foreground">{diagnostic.summary}</p>
            {diagnostic.evidence.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {diagnostic.evidence.map((line, index) => <li key={index}>{line}</li>)}
              </ul>
            )}
            {entry.stale ? (
              <p className="text-xs italic text-muted-foreground">{t("problems.stale")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(diagnostic.fixes ?? []).map((fix, index) => (
                  <button
                    key={index}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onFix(entry, index)}
                    className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                  >
                    <Wrench size={11} />
                    {fix.title}
                  </button>
                ))}
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSuppress(entry)}
                  className="flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <EyeOff size={11} />
                  {t("problems.markIntentional")}
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
