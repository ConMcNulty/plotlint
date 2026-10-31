import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { docToText, OffsetMap } from "./text.js";

/**
 * Ghost text (PLAN, "Ghost text (optional, off by default)"). After a pause in
 * typing at the end of a paragraph, the host is asked for a few words that could
 * come next. They are drawn greyed out after the cursor; Tab inserts them, and
 * Escape, typing or moving the cursor drops them. Off until `setGhostText(true)`.
 * The suggestion is a decoration, so it is never part of the text until accepted.
 */

export interface GhostRequest {
  /** The whole text, and the cursor's plain-text offset in it. */
  readonly text: string;
  readonly offset: number;
}

export interface GhostTextOptions {
  /** Words to show after the cursor, or null for none. Required for ghost text to do anything. */
  readonly suggest?: (request: GhostRequest) => Promise<string | null>;
  /** Pause after typing before asking. */
  readonly debounceMs?: number;
}

interface Ghost {
  readonly pos: number;
  readonly text: string;
}

interface GhostState {
  readonly enabled: boolean;
  readonly ghost: Ghost | null;
}

type Meta = { type: "enable"; enabled: boolean } | { type: "show"; ghost: Ghost } | { type: "clear" };

export const ghostTextPluginKey = new PluginKey<GhostState>("plotlintGhostText");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    ghostText: {
      /** Turn ghost text on or off; off also drops a suggestion on screen. */
      setGhostText: (enabled: boolean) => ReturnType;
      /** Insert the suggestion on screen. Fails when there is none. */
      acceptGhostText: () => ReturnType;
      /** Drop the suggestion on screen. Fails when there is none. */
      dismissGhostText: () => ReturnType;
    };
  }
}

/** The suggestion drawn now, if any. */
export function getGhostText(state: EditorState): Ghost | null {
  return ghostTextPluginKey.getState(state)?.ghost ?? null;
}

/** Whether ghost text is on. */
export function isGhostTextEnabled(state: EditorState): boolean {
  return ghostTextPluginKey.getState(state)?.enabled ?? false;
}

/** The cursor, when it is a collapsed selection at the end of a paragraph with words in it. */
function askPosition(state: EditorState): number | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $pos = selection.$head;
  if ($pos.parentOffset !== $pos.parent.content.size) return null;
  return $pos.parent.textContent.trim() ? $pos.pos : null;
}

function ghostElement(text: string): HTMLElement {
  const element = document.createElement("span");
  element.className = "pl-ghost";
  element.contentEditable = "false";
  element.setAttribute("aria-hidden", "true");
  element.textContent = text;
  return element;
}

function accept(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ghost = getGhostText(state);
  if (!ghost) return false;
  if (dispatch) dispatch(state.tr.insertText(ghost.text, ghost.pos).setMeta(ghostTextPluginKey, { type: "clear" } satisfies Meta).scrollIntoView());
  return true;
}

function dismiss(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  if (!getGhostText(state)) return false;
  if (dispatch) dispatch(state.tr.setMeta(ghostTextPluginKey, { type: "clear" } satisfies Meta).setMeta("addToHistory", false));
  return true;
}

export const GhostText = Extension.create<GhostTextOptions>({
  name: "ghostText",

  addOptions() {
    return {};
  },

  addCommands() {
    return {
      setGhostText: (enabled) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(ghostTextPluginKey, { type: "enable", enabled } satisfies Meta).setMeta("addToHistory", false);
        return true;
      },
      acceptGhostText: () => ({ state, dispatch }) => accept(state, dispatch),
      dismissGhostText: () => ({ state, dispatch }) => dismiss(state, dispatch),
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => accept(this.editor.state, this.editor.view.dispatch),
      Escape: () => dismiss(this.editor.state, this.editor.view.dispatch),
    };
  },

  addProseMirrorPlugins() {
    const { suggest } = this.options;
    const debounceMs = this.options.debounceMs ?? 700;
    return [new Plugin<GhostState>({
      key: ghostTextPluginKey,
      state: {
        init: () => ({ enabled: false, ghost: null }),
        apply(tr, previous) {
          const meta = tr.getMeta(ghostTextPluginKey) as Meta | undefined;
          if (meta?.type === "enable") return { enabled: meta.enabled, ghost: meta.enabled ? previous.ghost : null };
          if (meta?.type === "show") return previous.enabled ? { ...previous, ghost: meta.ghost } : previous;
          if (meta?.type === "clear") return previous.ghost ? { ...previous, ghost: null } : previous;
          // Typing or moving the cursor makes the suggestion stale.
          if (previous.ghost && (tr.docChanged || tr.selectionSet)) return { ...previous, ghost: null };
          return previous;
        },
      },
      view: () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let asked = 0;
        const cancel = () => {
          if (timer) clearTimeout(timer);
          timer = undefined;
          asked += 1;
        };
        const ask = (view: EditorView) => {
          const pos = askPosition(view.state);
          if (pos === null || !suggest) return;
          const doc = view.state.doc;
          const seq = ++asked;
          const map = OffsetMap.fromDoc(doc);
          void suggest({ text: docToText(doc), offset: map.toOffset(pos) }).then((text) => {
            // Only if nothing moved while the host was thinking.
            if (seq !== asked || !text || view.isDestroyed || view.state.doc !== doc || askPosition(view.state) !== pos) return;
            view.dispatch(view.state.tr.setMeta(ghostTextPluginKey, { type: "show", ghost: { pos, text } } satisfies Meta).setMeta("addToHistory", false));
          }, () => undefined);
        };
        return {
          update: (view, previous) => {
            const state = ghostTextPluginKey.getState(view.state);
            if (!state?.enabled) {
              cancel();
              return;
            }
            if (view.state.doc === previous.doc) {
              if (!view.state.selection.eq(previous.selection)) cancel();
              return;
            }
            cancel();
            timer = setTimeout(() => { timer = undefined; ask(view); }, debounceMs);
          },
          destroy: cancel,
        };
      },
      props: {
        decorations: (state) => {
          const ghost = getGhostText(state);
          return ghost ? DecorationSet.create(state.doc, [Decoration.widget(ghost.pos, () => ghostElement(ghost.text), { side: 1, key: `ghost:${ghost.text}` })]) : null;
        },
      },
    })];
  },
});
