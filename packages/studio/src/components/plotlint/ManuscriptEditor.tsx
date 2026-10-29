import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { EyeOff, ListTree, SearchX, ThumbsDown, Wrench } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { confidenceLabel, OffsetMap, type DefinitionRequest, type DiagnosticEntry, type TextRange } from "@plotlint/editor";
import "@plotlint/editor/styles.css";
import "./plotlint.css";
import type { TFunction } from "../../hooks/use-i18n";
import { cn } from "../../lib/utils";
import { createChapterEditor, type ChapterEditor, type ProblemsSnapshot } from "./chapter-editor";
import { chapterLinter, chapterSourceId, suppressDiagnostic, type LintDiagnostic, type LintFunction } from "./lint-client";
import { fetchStateAt, findDefinition, findReferences, type Definition, type EntityAtCursor, type EvidenceLocation, type References, type StateAtCursorResponse } from "./navigate-client";
import { ProblemsPanel } from "./ProblemsPanel";
import { ReferencesPanel } from "./ReferencesPanel";
import { StatePanel } from "./StatePanel";
import { problemRows, rowTarget, type ProblemRow } from "./problems-model";
import { recordVerdicts, type VerdictEvent } from "./verdict-client";

export interface ManuscriptEditorHandle {
  /** The chapter text as edited, exactly as it will be saved. */
  getText(): string;
  /** The underlying Tiptap editor, once mounted. */
  editor(): Editor | null;
  /** Select a plain-text range and scroll it into view. */
  revealRange(range: TextRange): void;
}

/** The state-at-cursor, go-to-definition and find-all-references lookups for the open chapter. */
export interface NavigationClient {
  stateAt(offset: number, text: string): Promise<StateAtCursorResponse>;
  /** The first of `names` that resolves, with its definitions in reading order; null when none does. */
  definition(names: ReadonlyArray<string>, text: string): Promise<{ name: string; definitions: Definition[] } | null>;
  /** Every appearance of the first of `names` found in the book; null when none is. */
  references?(names: ReadonlyArray<string>, text: string): Promise<References | null>;
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
  /** Override the state and definition routes (tests). */
  readonly navigation?: NavigationClient;
  /** Override the verdict route (tests). */
  readonly onVerdicts?: (events: VerdictEvent[]) => void;
  /** Select this text range once the editor opens (a jump from another chapter). */
  readonly selection?: TextRange;
  /** Open a passage in another chapter (an "established" link or a definition there). */
  readonly onOpenLocation?: (location: EvidenceLocation) => void;
  readonly className?: string;
}

interface HoverState {
  readonly entries: DiagnosticEntry[];
  readonly left: number;
  /** The underlined word's top and bottom, in viewport coordinates. */
  readonly anchorTop: number;
  readonly anchorBottom: number;
}

interface CursorState {
  readonly entities: EntityAtCursor[] | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly stateMissing: boolean;
}

interface Notice {
  readonly text: string;
  readonly left: number;
  readonly top: number;
}

const EMPTY: ProblemsSnapshot = { ranged: [], unranged: [], suppressed: 0, linting: true, error: null, stateMissing: false };

const chapterNavigation = (bookId: string, chapter: number): NavigationClient => ({
  stateAt: (offset, text) => fetchStateAt(bookId, chapter, offset, text),
  definition: (names, text) => findDefinition(bookId, names, { chapter, text }),
  references: (names, text) => findReferences(bookId, names, { chapter, text }),
});

/** Findings marked "Not useful" this session, per book, so they stay hidden when a chapter reopens. */
const sessionHidden = new Map<string, Set<string>>();
const hiddenFor = (bookId: string) => {
  let hidden = sessionHidden.get(bookId);
  if (!hidden) sessionHidden.set(bookId, hidden = new Set());
  return hidden;
};

const STATE_PANEL_KEY = "plotlint.statePanel";
/** Pause after the cursor moves before asking for the state there. */
const STATE_DEBOUNCE_MS = 300;

const readPanelPreference = () => {
  try {
    return window.localStorage.getItem(STATE_PANEL_KEY) !== "hidden";
  } catch {
    return true;
  }
};

/**
 * The Tiptap chapter editor with plotlint squiggles, a hover card per finding,
 * the state at the cursor beside it, and the problems panel below. F12 or
 * Ctrl/Cmd+click goes to where the name under the cursor is first established.
 */
export function ManuscriptEditor({
  bookId, chapterNumber, initialText, t, handleRef, lint, navigation, onVerdicts, selection, onOpenLocation, className,
}: ManuscriptEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ChapterEditor | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialTextRef = useRef(initialText);
  const initialSelectionRef = useRef(selection);
  const [problems, setProblems] = useState<ProblemsSnapshot>(EMPTY);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [showState, setShowState] = useState(readPanelPreference);
  const [cursor, setCursor] = useState<CursorState>({ entities: null, loading: false, error: null, stateMissing: false });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [references, setReferences] = useState<References | null>(null);

  const client = useMemo(() => navigation ?? chapterNavigation(bookId, chapterNumber), [navigation, bookId, chapterNumber]);
  // Read by the editor's callbacks, which are bound once per editor.
  // Accept and reject decisions go to the book's verdict log, for the writer study.
  const verdicts = useCallback((events: VerdictEvent[]) => {
    if (onVerdicts) onVerdicts(events);
    else void recordVerdicts(bookId, events);
  }, [bookId, onVerdicts]);
  const live = useRef({ client, showState, chapterNumber, onOpenLocation, verdicts });
  live.current = { client, showState, chapterNumber, onOpenLocation, verdicts };
  const stateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stateRequest = useRef({ seq: 0, offset: -1, text: "" });
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = undefined;
  };
  const hideSoon = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => setHover(null), 250);
  };

  /** Ask for the state at the cursor now, unless neither the cursor nor the text moved since the last ask. */
  const refreshState = useCallback(async (force = false) => {
    const controller = controllerRef.current;
    if (!controller || !live.current.showState) return;
    const offset = controller.selection().end;
    const text = controller.getText();
    const last = stateRequest.current;
    if (!force && last.offset === offset && last.text === text) return;
    const seq = last.seq + 1;
    stateRequest.current = { seq, offset, text };
    setCursor((previous) => ({ ...previous, loading: true }));
    try {
      const result = await live.current.client.stateAt(offset, text);
      if (stateRequest.current.seq !== seq) return;
      setCursor({ entities: result.entities, loading: false, error: null, stateMissing: result.stateMissing });
    } catch (error) {
      if (stateRequest.current.seq !== seq) return;
      // Ask again on the next cursor move.
      stateRequest.current = { ...stateRequest.current, offset: -1 };
      setCursor((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }, []);
  const refreshStateSoon = useCallback(() => {
    if (stateTimer.current) clearTimeout(stateTimer.current);
    stateTimer.current = setTimeout(() => { stateTimer.current = undefined; void refreshState(); }, STATE_DEBOUNCE_MS);
  }, [refreshState]);

  /** A short notice under a text position that fades on its own. */
  const showNotice = useCallback((text: string, at: TextRange) => {
    const view = controllerRef.current?.editor.view;
    if (!view) return;
    let coords: { left: number; bottom: number };
    try {
      coords = view.coordsAtPos(OffsetMap.fromDoc(view.state.doc).toPos(at.start));
    } catch {
      // No layout (tests): under the editor's top edge instead.
      const rect = view.dom.getBoundingClientRect();
      coords = { left: rect.left, bottom: rect.top };
    }
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ text, left: coords.left, top: coords.bottom + 4 });
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  }, []);

  /** Select a passage: here when it is in this chapter, otherwise through the reader. */
  const openLocation = useCallback((location: EvidenceLocation) => {
    if (location.chapter === live.current.chapterNumber) controllerRef.current?.revealRange(location);
    else live.current.onOpenLocation?.(location);
  }, []);

  const goToDefinition = useCallback(async (request: DefinitionRequest) => {
    try {
      const found = request.names.length > 0 ? await live.current.client.definition(request.names, request.text) : null;
      const first = found?.definitions[0];
      if (first) openLocation(first.location);
      else showNotice(request.names[0] ? `${t("state.noDefinition")}: ${request.names[0]}` : t("state.noDefinition"), request.range);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), request.range);
    }
  }, [openLocation, showNotice, t]);
  const goToDefinitionRef = useRef(goToDefinition);
  goToDefinitionRef.current = goToDefinition;

  const showReferences = useCallback(async (request: DefinitionRequest) => {
    try {
      const lookup = live.current.client.references;
      const found = lookup && request.names.length > 0 ? await lookup(request.names, request.text) : null;
      if (found) setReferences(found);
      else showNotice(request.names[0] ? `${t("refs.none")}: ${request.names[0]}` : t("refs.none"), request.range);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), request.range);
    }
  }, [showNotice, t]);
  const showReferencesRef = useRef(showReferences);
  showReferencesRef.current = showReferences;

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
      onVerdicts: (events) => live.current.verdicts(events),
      hidden: hiddenFor(bookId),
      onSelection: refreshStateSoon,
      onGoToDefinition: (request) => void goToDefinitionRef.current(request),
      onFindReferences: (request) => void showReferencesRef.current(request),
      ...(initialSelectionRef.current ? { selection: initialSelectionRef.current } : {}),
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
    void refreshState(true);
    return () => {
      cancelHide();
      if (stateTimer.current) clearTimeout(stateTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      controller.destroy();
      controllerRef.current = null;
    };
    // The editor is created once per chapter; text edits live inside it.
  }, [bookId, chapterNumber, lint, refreshState, refreshStateSoon]);

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
    revealRange: (range) => controllerRef.current?.revealRange(range),
  }), []);

  const toggleState = () => {
    const next = !showState;
    setShowState(next);
    live.current = { ...live.current, showState: next };
    try {
      window.localStorage.setItem(STATE_PANEL_KEY, next ? "shown" : "hidden");
    } catch {
      // Storage can be refused (a private window); the toggle still works on this page.
    }
    if (next) void refreshState(true);
  };

  const markIntentional = useCallback(async (diagnostic: LintDiagnostic) => {
    const reason = window.prompt(t("problems.reasonPrompt"))?.trim();
    if (!reason) return;
    try {
      await suppressDiagnostic(bookId, diagnostic, reason);
      live.current.verdicts([{ diagnostic, action: "intentional" }]);
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

  /** "Not useful" (on the hover card or a problems row): a rejection that also hides this finding for the rest of the session. */
  const notUseful = (diagnostic: LintDiagnostic) => {
    controllerRef.current?.hide(diagnostic);
    live.current.verdicts([{ diagnostic, action: "not-useful" }]);
    setHover(null);
  };

  const rows = useMemo(() => {
    const doc = controllerRef.current?.editor.state.doc;
    const lineOf = (pos: number) => (doc ? doc.resolve(Math.min(pos, doc.content.size)).index(0) + 1 : 0);
    return problemRows(problems.ranged, problems.unranged, lineOf);
  }, [problems]);

  /** A drawn finding selects its text; an unranged one opens where its fact was established. */
  const reveal = (row: ProblemRow) => {
    const target = rowTarget(row);
    if (target?.kind === "range") controllerRef.current?.reveal(target.entryId);
    else if (target?.kind === "established") openLocation(target.location);
  };

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <span>{t("state.gotoHint")}</span>
        <button
          type="button"
          aria-pressed={showState}
          onClick={toggleState}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-medium transition-colors",
            showState ? "border-primary/30 bg-primary/10 text-primary" : "border-border/50 hover:text-foreground",
          )}
          data-testid="state-toggle"
        >
          <ListTree size={12} />
          {t("state.toggle")}
        </button>
      </div>
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <div ref={mountRef} className="pl-manuscript min-w-0 flex-1" data-testid="manuscript-editor" />
        {showState && (
          <StatePanel
            entities={cursor.entities}
            chapter={chapterNumber}
            loading={cursor.loading}
            error={cursor.error}
            stateMissing={cursor.stateMissing}
            t={t}
            onOpen={openLocation}
            className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:w-80 xl:shrink-0 xl:overflow-y-auto"
          />
        )}
      </div>
      {references && (
        <ReferencesPanel
          references={references}
          chapter={chapterNumber}
          t={t}
          onOpen={openLocation}
          onClose={() => setReferences(null)}
        />
      )}
      <ProblemsPanel
        rows={rows}
        suppressed={problems.suppressed}
        linting={problems.linting}
        error={problems.error}
        stateMissing={problems.stateMissing}
        t={t}
        onSelect={reveal}
        onSuppress={(row) => void markIntentional(row.diagnostic)}
        onNotUseful={(row) => notUseful(row.diagnostic)}
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
          onNotUseful={(entry) => notUseful(entry.diagnostic as LintDiagnostic)}
        />,
        document.body,
      )}
      {notice && typeof document !== "undefined" && createPortal(
        <div
          role="status"
          data-testid="goto-notice"
          className="fixed z-50 flex items-center gap-1.5 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg"
          style={{ left: Math.max(8, notice.left), top: notice.top }}
        >
          <SearchX size={12} className="text-muted-foreground" />
          {notice.text}
        </div>,
        document.body,
      )}
    </div>
  );
}

function DiagnosticCard({ hover, t, onEnter, onLeave, onFix, onSuppress, onNotUseful }: {
  readonly hover: HoverState;
  readonly t: TFunction;
  readonly onEnter: () => void;
  readonly onLeave: () => void;
  readonly onFix: (entry: DiagnosticEntry, index: number) => void;
  readonly onSuppress: (entry: DiagnosticEntry) => void;
  readonly onNotUseful: (entry: DiagnosticEntry) => void;
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
                <button
                  type="button"
                  title={t("problems.notUsefulHint")}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onNotUseful(entry)}
                  className="flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  data-testid="diagnostic-not-useful"
                >
                  <ThumbsDown size={11} />
                  {t("problems.notUseful")}
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
