import type { Diagnostic } from "@plotlint/diagnostics";
import { Extension } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import {
  applyFixToTransaction,
  changedRanges,
  createDiagnosticsPlugin,
  diagnosticsAt,
  findDiagnostic,
  getDiagnostics,
  getLintSnapshot,
  withDiagnostics,
  withoutDiagnostics,
  type ChangedRanges,
  type DiagnosticEntry,
  type DiagnosticsPluginOptions,
  type SetDiagnosticsOptions,
} from "./plugin.js";

export type DiagnosticsOptions = DiagnosticsPluginOptions;

export interface DiagnosticsStorage {
  /** Diagnostics whose range contains or touches position `pos`. */
  diagnosticsAt(pos: number): DiagnosticEntry[];
  /** All diagnostics drawn in the editor, in document order. */
  all(): DiagnosticEntry[];
  find(id: string): DiagnosticEntry | undefined;
  changedRanges(): ChangedRanges;
  lintSnapshot(): ChangedRanges & { readonly text: string };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    diagnostics: {
      /** Show lint results for `options.sourceId`; diagnostics without a range or for another source are skipped. */
      setDiagnostics: (diagnostics: ReadonlyArray<Diagnostic>, options: SetDiagnosticsOptions) => ReturnType;
      clearDiagnostics: () => ReturnType;
      /** Replace a diagnostic's current range with one of its fixes. Fails on stale diagnostics. */
      applyDiagnosticFix: (id: string, fixIndex?: number) => ReturnType;
    };
  }
  interface Storage {
    diagnostics: DiagnosticsStorage;
  }
}

/** Inline diagnostics: squiggles from `Diagnostic[]` that move with edits, quick fixes and re-lint tracking. */
export const Diagnostics = Extension.create<DiagnosticsOptions, DiagnosticsStorage>({
  name: "diagnostics",

  addOptions() {
    return {};
  },

  addStorage() {
    const unbound = (): never => { throw new Error("diagnostics storage used before the editor was created"); };
    return { diagnosticsAt: unbound, all: unbound, find: unbound, changedRanges: unbound, lintSnapshot: unbound };
  },

  onBeforeCreate() {
    const editor = this.editor;
    Object.assign(this.storage, {
      diagnosticsAt: (pos: number) => diagnosticsAt(editor.state, pos),
      all: () => getDiagnostics(editor.state),
      find: (id: string) => findDiagnostic(editor.state, id),
      changedRanges: () => changedRanges(editor.state),
      lintSnapshot: () => getLintSnapshot(editor.state),
    } satisfies DiagnosticsStorage);
  },

  addCommands() {
    return {
      setDiagnostics: (diagnostics, options) => ({ tr, dispatch }) => {
        if (dispatch) withDiagnostics(tr, diagnostics, options);
        return true;
      },
      clearDiagnostics: () => ({ tr, dispatch }) => {
        if (dispatch) withoutDiagnostics(tr);
        return true;
      },
      applyDiagnosticFix: (id, fixIndex = 0) => ({ state, tr, dispatch }) => {
        const entry = findDiagnostic(state, id);
        if (!entry || entry.stale || !entry.diagnostic.fixes?.[fixIndex]) return false;
        return dispatch ? applyFixToTransaction(state, tr, id, fixIndex) : true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [createDiagnosticsPlugin(this.options)];
  },
});

/**
 * The schema the text model assumes: a document of plain paragraphs holding text.
 * Add undo history and other behaviour in Studio; keep block types to paragraphs
 * so `docToText` stays an exact round trip of the chapter text.
 */
export const PlainTextDocument = [Document, Paragraph, Text];
