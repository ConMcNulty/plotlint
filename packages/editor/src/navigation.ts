import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { docToText, OffsetMap, type TextRange } from "./text.js";

/**
 * IDE-style navigation in plain-text offsets: the selection as a text range,
 * selecting a text range (an evidence span, a definition), the name under the
 * cursor, and a go-to-definition gesture (F12, or Ctrl/Cmd+click) that reports
 * what to look up. Looking it up is the host's job.
 */

/** The selection as a plain-text range (empty at the cursor). */
export function selectionTextRange(state: EditorState): TextRange {
  const map = OffsetMap.fromDoc(state.doc);
  const { from, to } = state.selection;
  return { start: map.toOffset(from), end: map.toOffset(to) };
}

/** A text selection over a plain-text range, clamped to the document. */
export function textRangeSelection(doc: ProseMirrorNode, range: TextRange): TextSelection {
  const map = OffsetMap.fromDoc(doc);
  return TextSelection.create(doc, map.toPos(range.start), map.toPos(Math.max(range.start, range.end)));
}

let wordSegmenter: Intl.Segmenter | undefined;

/** The word at `offset` (or just before it, for a cursor at a word's end), by Unicode word segmentation. */
export function wordRangeAt(text: string, offset: number): TextRange | null {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = text.indexOf("\n", offset);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  const within = offset - lineStart;
  wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: "word" });
  let found: TextRange | null = null;
  for (const { segment, index, isWordLike } of wordSegmenter.segment(line)) {
    if (!isWordLike) continue;
    const end = index + segment.length;
    if (index <= within && within < end) return { start: lineStart + index, end: lineStart + end };
    if (end === within) found = { start: lineStart + index, end: lineStart + end };
    if (index > within) break;
  }
  return found;
}

/** A capitalised name token: "Mira", "Okonkwo-Hale", "O'Neill". */
const NAME_TOKEN = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;
const isCapitalised = (token: string) => /^\p{Lu}/u.test(token);
const stripPossessive = (name: string) => name.replace(/['’]s$/u, "");

/**
 * Names to look up for a range, best first. A selection is the name as selected.
 * At a cursor, a capitalised word grows to the run of capitalised words around it
 * on the same line ("Mira Vale", "Captain Aurel Harrow"), then falls back to the
 * hyphenated token and the bare word.
 */
export function nameCandidatesAt(text: string, range: TextRange): string[] {
  const candidates: string[] = [];
  const add = (name: string) => {
    const clean = stripPossessive(name.replace(/\s+/g, " ").trim());
    if (clean && !candidates.includes(clean)) candidates.push(clean);
  };
  if (range.end > range.start) {
    add(text.slice(range.start, range.end));
    return candidates;
  }
  const word = wordRangeAt(text, range.start);
  if (!word) return candidates;

  const lineStart = text.lastIndexOf("\n", word.start - 1) + 1;
  const lineEnd = text.indexOf("\n", word.end);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  const tokens = [...line.matchAll(NAME_TOKEN)].map((match) => ({ start: lineStart + match.index, end: lineStart + match.index + match[0].length, text: match[0] }));
  const at = tokens.findIndex((token) => token.start <= word.start && word.end <= token.end);
  if (at >= 0 && isCapitalised(tokens[at]!.text)) {
    // Neighbours join the name when they are capitalised and one space away.
    const joined = (left: number, right: number) => text.slice(tokens[left]!.end, tokens[right]!.start) === " ";
    let first = at;
    let last = at;
    while (first > 0 && isCapitalised(tokens[first - 1]!.text) && joined(first - 1, first)) first -= 1;
    while (last < tokens.length - 1 && isCapitalised(tokens[last + 1]!.text) && joined(last, last + 1)) last += 1;
    add(text.slice(tokens[first]!.start, tokens[last]!.end));
  }
  if (at >= 0) add(tokens[at]!.text);
  add(text.slice(word.start, word.end));
  return candidates;
}

/** What the writer asked to look up. */
export interface DefinitionRequest {
  /** Names to try, best first (see {@link nameCandidatesAt}). */
  readonly names: string[];
  /** The selection, or the cursor or click position, in plain-text offsets. */
  readonly range: TextRange;
  /** The document's text when asked. */
  readonly text: string;
}

export interface NavigationOptions {
  /** Called on F12, or Ctrl/Cmd+click, with the names under the selection or pointer. */
  readonly onGoToDefinition?: (request: DefinitionRequest) => void;
}

export interface NavigationStorage {
  /** The selection as a plain-text range. */
  selection(): TextRange;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    navigation: {
      /** Select a plain-text range (clamped to the document) and scroll it into view. */
      selectTextRange: (range: TextRange) => ReturnType;
    };
  }
  interface Storage {
    navigation: NavigationStorage;
  }
}

/**
 * Center the selection's start in its scroll containers, where the browser supports it.
 * Instant, not smooth: a smooth scroll aims at where the text was when it started, and
 * a page still laying out (a panel above loading) leaves the text off screen.
 */
export function scrollSelectionToCenter(view: EditorView): void {
  const { node } = view.domAtPos(view.state.selection.from);
  const element = node instanceof Element ? node : node.parentElement;
  element?.scrollIntoView?.({ block: "center", behavior: "instant" });
}

function definitionRequest(state: EditorState, range: TextRange): DefinitionRequest {
  const text = docToText(state.doc);
  return { names: nameCandidatesAt(text, range), range, text };
}

const navigationPluginKey = new PluginKey("plotlintNavigation");

/** Go to definition (F12, Ctrl/Cmd+click) and text-range selection for the plain-text editor. */
export const Navigation = Extension.create<NavigationOptions, NavigationStorage>({
  name: "navigation",

  addOptions() {
    return {};
  },

  addStorage() {
    return { selection: () => ({ start: 0, end: 0 }) };
  },

  onBeforeCreate() {
    const editor = this.editor;
    this.storage.selection = () => selectionTextRange(editor.state);
  },

  addCommands() {
    return {
      selectTextRange: (range) => ({ tr, dispatch }) => {
        if (dispatch) tr.setSelection(textRangeSelection(tr.doc, range)).scrollIntoView();
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      F12: () => {
        const callback = this.options.onGoToDefinition;
        if (!callback) return false;
        callback(definitionRequest(this.editor.state, selectionTextRange(this.editor.state)));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin({
      key: navigationPluginKey,
      props: {
        handleDOMEvents: {
          // On mousedown, before the click moves the cursor: a modified click inside
          // the selection looks up the selection, anywhere else the word under it.
          mousedown: (view, event) => {
            if (!options.onGoToDefinition || event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
            const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!hit) return false;
            const { from, to, empty } = view.state.selection;
            const map = OffsetMap.fromDoc(view.state.doc);
            const range = !empty && from <= hit.pos && hit.pos <= to
              ? { start: map.toOffset(from), end: map.toOffset(to) }
              : { start: map.toOffset(hit.pos), end: map.toOffset(hit.pos) };
            event.preventDefault();
            options.onGoToDefinition(definitionRequest(view.state, range));
            return true;
          },
        },
      },
    })];
  },
});
