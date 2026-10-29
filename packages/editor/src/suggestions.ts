import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { diffWordsWithSpace } from "diff";
import { docToText, OffsetMap } from "./text.js";

/**
 * Suggestions as tracked changes (PLAN, "Suggestions as tracked changes"). An
 * agent's edit is shown against the text it replaced: the document holds the
 * agent's text, each inserted span is underlined, and the words it removed sit
 * struck through in front of it, with accept and reject buttons. Accepting keeps
 * the agent's words; rejecting puts the old ones back. The document is always the
 * text with every open suggestion accepted, so saving, linting and plain-text
 * offsets work as they do without suggestions.
 */

/** One change, in plain-text offsets of the proposed text: `[start, end)` was inserted where `deleted` stood. */
export interface TextSuggestion {
  readonly start: number;
  readonly end: number;
  readonly deleted: string;
}

/** An open suggestion in the editor, in ProseMirror positions. */
export interface Suggestion {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly deleted: string;
}

/** The changes that turn `base` into `proposed`, word by word, adjacent removals and insertions merged. */
export function suggestionsBetween(base: string, proposed: string): TextSuggestion[] {
  if (base === proposed) return [];
  const out: TextSuggestion[] = [];
  let offset = 0;
  let open: { start: number; end: number; deleted: string } | null = null;
  const parts = diffWordsWithSpace(base, proposed);
  parts.forEach((part, index) => {
    const next = parts[index + 1];
    // Only a space between two changes: one change ("walked" → "ran down"), not two.
    if (open && !part.added && !part.removed && /^[^\S\n]+$/u.test(part.value) && (next?.added || next?.removed)) {
      open.end += part.value.length;
      open.deleted += part.value;
      offset += part.value.length;
      return;
    }
    if (part.added || part.removed) {
      open ??= { start: offset, end: offset, deleted: "" };
      if (part.added) {
        open.end += part.value.length;
        offset += part.value.length;
      } else {
        open.deleted += part.value;
      }
    } else {
      if (open) out.push(open);
      open = null;
      offset += part.value.length;
    }
  });
  if (open) out.push(open);
  return out;
}

export const suggestionsPluginKey = new PluginKey<SuggestionsState>("plotlintSuggestions");

interface SuggestionsState {
  readonly suggestions: ReadonlyArray<Suggestion>;
  readonly decorations: DecorationSet;
}

type Meta = { type: "set"; suggestions: Suggestion[] } | { type: "remove"; ids: ReadonlyArray<string> };

let nextId = 0;

const shown = (text: string) => text.replace(/\n/gu, " ¶ ");

function widget(suggestion: Suggestion, labels: SuggestionLabels): HTMLElement {
  const root = document.createElement("span");
  root.className = "pl-suggestion";
  root.contentEditable = "false";
  root.dataset.suggestionId = suggestion.id;
  if (suggestion.deleted) {
    const del = document.createElement("del");
    del.className = "pl-suggestion-delete";
    del.textContent = shown(suggestion.deleted);
    root.append(del);
  }
  for (const [action, text, title] of [["accept", "✓", labels.accept], ["reject", "✗", labels.reject]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pl-suggestion-${action}`;
    button.dataset.suggestionAction = action;
    button.dataset.suggestionId = suggestion.id;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.textContent = text;
    root.append(button);
  }
  return root;
}

function decorate(doc: ProseMirrorNode, suggestions: ReadonlyArray<Suggestion>, labels: SuggestionLabels): DecorationSet {
  const decorations: Decoration[] = [];
  for (const suggestion of suggestions) {
    decorations.push(Decoration.widget(suggestion.from, () => widget(suggestion, labels), { side: -1, key: `${suggestion.id}:${suggestion.deleted.length}`, ignoreSelection: true }));
    if (suggestion.to > suggestion.from) {
      decorations.push(Decoration.inline(suggestion.from, suggestion.to, { class: "pl-suggestion-insert", "data-suggestion-id": suggestion.id }));
    }
  }
  return DecorationSet.create(doc, decorations);
}

export interface SuggestionLabels {
  readonly accept: string;
  readonly reject: string;
}

export interface SuggestionsOptions {
  readonly labels?: SuggestionLabels;
  /** Called whenever the open suggestions change. */
  readonly onChange?: (suggestions: ReadonlyArray<Suggestion>) => void;
}

/** The open suggestions, in document order. */
export function getSuggestions(state: EditorState): ReadonlyArray<Suggestion> {
  return suggestionsPluginKey.getState(state)?.suggestions ?? [];
}

/** Put the old words back in place of suggestion `id`'s insertion, in `tr`. */
function rejectInto(tr: Transaction, suggestion: Suggestion): void {
  const from = tr.mapping.map(suggestion.from, -1);
  const to = Math.max(from, tr.mapping.map(suggestion.to, 1));
  tr.delete(from, to);
  let pos = from;
  suggestion.deleted.split("\n").forEach((part, index) => {
    if (index > 0) {
      tr.split(pos);
      pos += 2;
    }
    if (part) {
      tr.insertText(part, pos);
      pos += part.length;
    }
  });
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggestions: {
      /** Show `proposed` (the document's text) as tracked changes against `base`. */
      suggestFromBase: (base: string) => ReturnType;
      acceptSuggestion: (id: string) => ReturnType;
      rejectSuggestion: (id: string) => ReturnType;
      acceptAllSuggestions: () => ReturnType;
      rejectAllSuggestions: () => ReturnType;
    };
  }
}

const DEFAULT_LABELS: SuggestionLabels = { accept: "Accept change", reject: "Reject change" };

function act(view: EditorView, action: string, id: string): boolean {
  const suggestion = getSuggestions(view.state).find((entry) => entry.id === id);
  if (!suggestion) return false;
  const tr = view.state.tr;
  if (action === "reject") rejectInto(tr, suggestion);
  tr.setMeta(suggestionsPluginKey, { type: "remove", ids: [id] } satisfies Meta);
  view.dispatch(tr);
  return true;
}

export const Suggestions = Extension.create<SuggestionsOptions>({
  name: "suggestions",

  addOptions() {
    return {};
  },

  addCommands() {
    return {
      suggestFromBase: (base) => ({ state, tr, dispatch }) => {
        const map = OffsetMap.fromDoc(state.doc);
        const suggestions = suggestionsBetween(base, docToText(state.doc)).map((change): Suggestion => ({
          id: `s${++nextId}`,
          from: map.toPos(change.start),
          to: map.toPos(change.end),
          deleted: change.deleted,
        }));
        if (dispatch) tr.setMeta(suggestionsPluginKey, { type: "set", suggestions } satisfies Meta).setMeta("addToHistory", false);
        return true;
      },
      acceptSuggestion: (id) => ({ state, tr, dispatch }) => {
        if (!getSuggestions(state).some((entry) => entry.id === id)) return false;
        if (dispatch) tr.setMeta(suggestionsPluginKey, { type: "remove", ids: [id] } satisfies Meta);
        return true;
      },
      rejectSuggestion: (id) => ({ state, tr, dispatch }) => {
        const suggestion = getSuggestions(state).find((entry) => entry.id === id);
        if (!suggestion) return false;
        if (dispatch) {
          rejectInto(tr, suggestion);
          tr.setMeta(suggestionsPluginKey, { type: "remove", ids: [id] } satisfies Meta);
        }
        return true;
      },
      acceptAllSuggestions: () => ({ state, tr, dispatch }) => {
        const ids = getSuggestions(state).map((entry) => entry.id);
        if (dispatch && ids.length) tr.setMeta(suggestionsPluginKey, { type: "remove", ids } satisfies Meta);
        return ids.length > 0;
      },
      rejectAllSuggestions: () => ({ state, tr, dispatch }) => {
        const open = getSuggestions(state);
        if (dispatch && open.length) {
          // Last first, so earlier positions stay valid without mapping across our own edits.
          for (const suggestion of [...open].reverse()) rejectInto(tr, suggestion);
          tr.setMeta(suggestionsPluginKey, { type: "remove", ids: open.map((entry) => entry.id) } satisfies Meta);
        }
        return open.length > 0;
      },
    };
  },

  addProseMirrorPlugins() {
    const labels = this.options.labels ?? DEFAULT_LABELS;
    const onChange = this.options.onChange;
    return [new Plugin<SuggestionsState>({
      key: suggestionsPluginKey,
      state: {
        init: (_, state) => ({ suggestions: [], decorations: DecorationSet.empty.map(state.tr.mapping, state.doc) }),
        apply(tr, previous, _old, next) {
          const meta = tr.getMeta(suggestionsPluginKey) as Meta | undefined;
          let suggestions = previous.suggestions;
          if (tr.docChanged) {
            suggestions = suggestions.flatMap((entry) => {
              const from = tr.mapping.map(entry.from, -1);
              const to = Math.max(from, tr.mapping.map(entry.to, 1));
              // An insertion the writer deleted, with nothing to restore, is no longer a change.
              return to === from && !entry.deleted ? [] : [{ ...entry, from, to }];
            });
          }
          if (meta?.type === "set") suggestions = meta.suggestions;
          if (meta?.type === "remove") suggestions = suggestions.filter((entry) => !meta.ids.includes(entry.id));
          if (suggestions === previous.suggestions && !tr.docChanged) return previous;
          return { suggestions, decorations: decorate(next.doc, suggestions, labels) };
        },
      },
      view: () => ({
        update: (view, previous) => {
          const before = suggestionsPluginKey.getState(previous)?.suggestions;
          const after = suggestionsPluginKey.getState(view.state)?.suggestions;
          if (before !== after) onChange?.(after ?? []);
        },
      }),
      props: {
        decorations: (state) => suggestionsPluginKey.getState(state)?.decorations,
        handleDOMEvents: {
          mousedown: (view, event) => {
            const target = (event.target as HTMLElement | null)?.closest?.("[data-suggestion-action]") as HTMLElement | null;
            if (!target) return false;
            event.preventDefault();
            return act(view, target.dataset.suggestionAction!, target.dataset.suggestionId!);
          },
        },
      },
    })];
  },
});
