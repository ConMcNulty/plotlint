import { Editor, Extension } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import {
  Diagnostics,
  Navigation,
  PlainTextDocument,
  docToText,
  getDiagnosticsState,
  scrollSelectionToCenter,
  textToDoc,
  type DefinitionRequest,
  type DiagnosticEntry,
  type HoverContext,
  type TextRange,
} from "@plotlint/editor";
import type { LintDiagnostic, LintFunction } from "./lint-client";

/**
 * The chapter editor without React: a Tiptap editor over the chapter's plain
 * text (one paragraph per line, so `getText()` returns the text exactly as
 * loaded until it is edited), undo history, inline diagnostics, and a lint
 * loop that lints the whole chapter on open and then, after a pause in typing,
 * only the paragraphs changed since the last lint. Navigation (go to definition,
 * selecting a text range) comes from @plotlint/editor's Navigation extension.
 */

/** Undo and redo for the plain-text document (Mod-z, Shift-Mod-z, Mod-y). */
export const PlainTextHistory = Extension.create({
  name: "plainTextHistory",
  addProseMirrorPlugins() {
    return [history()];
  },
  addKeyboardShortcuts() {
    const run = (command: typeof undo) => () => command(this.editor.state, this.editor.view.dispatch);
    return { "Mod-z": run(undo), "Shift-Mod-z": run(redo), "Mod-y": run(redo) };
  },
});

export interface ProblemsSnapshot {
  /** Findings drawn in the text, at their current positions. */
  readonly ranged: ReadonlyArray<DiagnosticEntry>;
  /** Findings with no range (L3 state checks), from the latest lint. */
  readonly unranged: ReadonlyArray<LintDiagnostic>;
  /** Findings hidden by suppressions, as of the last whole-chapter lint. */
  readonly suppressed: number;
  readonly linting: boolean;
  readonly error: string | null;
  readonly stateMissing: boolean;
}

export interface ChapterEditorOptions {
  readonly element: HTMLElement;
  readonly text: string;
  readonly sourceId: string;
  readonly lint: LintFunction;
  /** Pause after typing before a re-lint. */
  readonly debounceMs?: number;
  readonly onProblems?: (problems: ProblemsSnapshot) => void;
  readonly onHover?: (entries: DiagnosticEntry[], context: HoverContext) => void;
  readonly onChange?: (text: string) => void;
  /** Called when the selection moves or the text changes. */
  readonly onSelection?: (selection: TextRange) => void;
  /** Called on F12 or Ctrl/Cmd+click with the names to look up. */
  readonly onGoToDefinition?: (request: DefinitionRequest) => void;
  /** Select this range once the editor opens (a jump from another chapter). */
  readonly selection?: TextRange;
  readonly editorClass?: string;
}

export interface ChapterEditor {
  readonly editor: Editor;
  getText(): string;
  /** Lint the whole chapter again (after a suppression is saved, say). */
  relintAll(): Promise<void>;
  /** Re-lint changed paragraphs now instead of waiting for the debounce. */
  flush(): Promise<void>;
  applyFix(id: string, fixIndex: number): boolean;
  /** Select a drawn diagnostic's text and scroll it into view. */
  reveal(id: string): boolean;
  /** Select a plain-text range and scroll it to the middle of the view. */
  revealRange(range: TextRange): void;
  /** The selection as a plain-text range. */
  selection(): TextRange;
  problems(): ProblemsSnapshot;
  destroy(): void;
}

export function createChapterEditor(options: ChapterEditorOptions): ChapterEditor {
  const { sourceId, lint } = options;
  const debounceMs = options.debounceMs ?? 400;

  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = null as Promise<void> | null;
  let wantFull = false;
  let rerun = false;
  let unranged: LintDiagnostic[] = [];
  let suppressed = 0;
  let stateMissing = false;
  let error: string | null = null;
  let lastDecorations: unknown;

  const computeProblems = (): ProblemsSnapshot => ({
    ranged: editor.storage.diagnostics.all(),
    unranged,
    suppressed,
    linting: running !== null,
    error,
    stateMissing,
  });
  const emit = () => {
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = undefined;
    if (destroyed) return;
    options.onProblems?.(computeProblems());
  };

  let emitTimer: ReturnType<typeof setTimeout> | undefined;
  const emitSoon = () => {
    if (emitTimer) return;
    emitTimer = setTimeout(() => { emitTimer = undefined; emit(); }, 150);
  };

  const schedule = () => {
    if (destroyed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void runLint(); }, debounceMs);
  };

  /** One lint at a time; edits made meanwhile are picked up by the next run. */
  const runLint = async (): Promise<void> => {
    if (running) {
      rerun = true;
      return;
    }
    if (destroyed) return;
    const full = wantFull;
    const lintSnapshot = editor.storage.diagnostics.lintSnapshot();
    if (!full && lintSnapshot.ranges.length === 0) return;
    wantFull = false;
    const ranges = full ? undefined : lintSnapshot.ranges.map(({ start, end }) => ({ start, end }));

    running = (async () => {
      try {
        const result = await lint({ text: lintSnapshot.text, ...(ranges ? { ranges } : {}) });
        if (destroyed) return;
        error = null;
        unranged = result.diagnostics.filter((diagnostic) => !diagnostic.range);
        stateMissing = result.stateMissing;
        if (full) suppressed = result.suppressed;
        const ranged = result.diagnostics.filter((diagnostic) => diagnostic.range);
        editor.commands.setDiagnostics(ranged, {
          sourceId,
          version: lintSnapshot.version,
          ...(full ? {} : { ranges: result.ranges ?? ranges }),
        });
      } catch (caught) {
        if (destroyed) return;
        error = caught instanceof Error ? caught.message : String(caught);
        // Retry a failed whole-chapter lint with the next edit's lint.
        if (full) wantFull = true;
      }
    })();
    emit();
    try {
      await running;
    } finally {
      running = null;
    }
    if (destroyed) return;
    emit();
    // Edits made while this lint ran, or a refused stale result, still need linting.
    if (wantFull && !error) {
      void runLint();
    } else if (rerun) {
      rerun = false;
      void runLint();
    } else if (!error && editor.storage.diagnostics.changedRanges().ranges.length > 0) {
      schedule();
    }
  };

  const editor: Editor = new Editor({
    element: options.element,
    extensions: [
      ...PlainTextDocument,
      PlainTextHistory,
      Diagnostics.configure({
        onChangedRanges: (changed) => {
          if (changed.ranges.length > 0 && !running) schedule();
        },
        onHover: options.onHover,
      }),
      Navigation.configure({ onGoToDefinition: options.onGoToDefinition }),
    ],
    content: textToDoc(options.text),
    editorProps: options.editorClass ? { attributes: { class: options.editorClass, spellcheck: "false" } } : { attributes: { spellcheck: "false" } },
    onUpdate: ({ editor: current }) => {
      options.onChange?.(docToText(current.state.doc));
    },
    onSelectionUpdate: ({ editor: current }) => {
      options.onSelection?.(current.storage.navigation.selection());
    },
    onTransaction: ({ editor: current, transaction }) => {
      const decorations = getDiagnosticsState(current.state)?.decorations;
      if (decorations === lastDecorations) return;
      lastDecorations = decorations;
      // Typing only moves existing squiggles; refresh the problems list after a
      // short pause instead of on every keystroke, so long chapters stay fast.
      if (transaction.docChanged) emitSoon();
      else emit();
    },
  });

  /** Run a lint now, after any lint in flight, and resolve once it is done. */
  const settle = async () => {
    for (let current = running; current; current = running) await current.catch(() => undefined);
  };
  const lintNow = async () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    await settle();
    rerun = false;
    await runLint();
    await settle();
  };
  const relintAll = () => {
    wantFull = true;
    return lintNow();
  };
  void relintAll();

  const revealRange = (range: TextRange) => {
    editor.chain().focus().selectTextRange(range).run();
    scrollSelectionToCenter(editor.view);
  };
  if (options.selection) revealRange(options.selection);

  return {
    editor,
    getText: () => docToText(editor.state.doc),
    relintAll,
    flush: lintNow,
    applyFix: (id, fixIndex) => editor.chain().focus().applyDiagnosticFix(id, fixIndex).run(),
    reveal: (id) => {
      const entry = editor.storage.diagnostics.find(id);
      if (!entry) return false;
      editor.chain().focus().setTextSelection({ from: entry.from, to: entry.to }).scrollIntoView().run();
      return true;
    },
    revealRange,
    selection: () => editor.storage.navigation.selection(),
    problems: computeProblems,
    destroy: () => {
      destroyed = true;
      if (timer) clearTimeout(timer);
      if (emitTimer) clearTimeout(emitTimer);
      editor.destroy();
    },
  };
}
