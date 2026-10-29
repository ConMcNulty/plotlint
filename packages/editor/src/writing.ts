import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { OffsetMap } from "./text.js";

/**
 * Writing aids (PLAN, "Centre: editor" and "Gutter markers"): focus mode, which
 * dims every paragraph but the one being written, and scene markers, which put a
 * mark in the left margin where a scene with findings starts. Both are
 * decorations only, so the text, linting and saving are unchanged.
 */

export const focusPluginKey = new PluginKey<boolean>("plotlintFocus");

/** The top-level paragraph the selection head is in, as a ProseMirror range. */
function currentParagraph(state: EditorState): { from: number; to: number } | null {
  const $head = state.selection.$head;
  if ($head.depth < 1) return null;
  return { from: $head.before(1), to: $head.after(1) };
}

function focusDecorations(state: EditorState): DecorationSet {
  const current = currentParagraph(state);
  const decorations: Decoration[] = [];
  state.doc.forEach((node, offset) => {
    if (current && offset === current.from) return;
    decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: "pl-focus-dim" }));
  });
  return DecorationSet.create(state.doc, decorations);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    focusMode: {
      /** Dim every paragraph but the one with the cursor, or stop. */
      setFocusMode: (enabled: boolean) => ReturnType;
    };
    sceneMarkers: {
      /** Replace the margin markers; `offset` is a plain-text offset, drawn at the start of its paragraph. */
      setSceneMarkers: (markers: ReadonlyArray<SceneMarker>) => ReturnType;
    };
  }
}

export const FocusMode = Extension.create({
  name: "focusMode",

  addCommands() {
    return {
      setFocusMode: (enabled) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(focusPluginKey, enabled).setMeta("addToHistory", false);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin<boolean>({
      key: focusPluginKey,
      state: {
        init: () => false,
        apply: (tr, enabled) => (tr.getMeta(focusPluginKey) as boolean | undefined) ?? enabled,
      },
      props: {
        decorations: (state) => (focusPluginKey.getState(state) ? focusDecorations(state) : null),
        attributes: (state): Record<string, string> => (focusPluginKey.getState(state) ? { class: "pl-focus" } : {}),
      },
    })];
  },
});

/** Whether focus mode is on. */
export function isFocusMode(state: EditorState): boolean {
  return focusPluginKey.getState(state) ?? false;
}

export interface SceneMarker {
  readonly id: string;
  /** Plain-text offset of the scene's start. */
  readonly offset: number;
  readonly severity: "error" | "warning" | "note";
  /** Shown on hover. */
  readonly title: string;
  /** How many findings the marker stands for. */
  readonly count: number;
}

interface PlacedMarker extends SceneMarker {
  readonly pos: number;
}

export const sceneMarkersPluginKey = new PluginKey<{ markers: PlacedMarker[]; decorations: DecorationSet }>("plotlintSceneMarkers");

function markerElement(marker: PlacedMarker): HTMLElement {
  const element = document.createElement("span");
  element.className = `pl-scene-marker pl-scene-marker--${marker.severity}`;
  element.contentEditable = "false";
  element.dataset.sceneMarker = marker.id;
  element.title = marker.title;
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", marker.title);
  element.textContent = String(marker.count);
  return element;
}

function markerDecorations(doc: ProseMirrorNode, markers: ReadonlyArray<PlacedMarker>): DecorationSet {
  return DecorationSet.create(doc, markers.map((marker) => Decoration.widget(marker.pos, () => markerElement(marker), {
    side: -1, key: `${marker.id}:${marker.count}:${marker.severity}:${marker.title}`, ignoreSelection: true,
  })));
}

export interface SceneMarkersOptions {
  /** Called when the writer clicks a marker. */
  readonly onSelect?: (id: string) => void;
}

/** The markers drawn now, at their current positions. */
export function getSceneMarkers(state: EditorState): ReadonlyArray<SceneMarker & { readonly pos: number }> {
  return sceneMarkersPluginKey.getState(state)?.markers ?? [];
}

export const SceneMarkers = Extension.create<SceneMarkersOptions>({
  name: "sceneMarkers",

  addOptions() {
    return {};
  },

  addCommands() {
    return {
      setSceneMarkers: (markers) => ({ state, tr, dispatch }) => {
        if (!dispatch) return true;
        const map = OffsetMap.fromDoc(state.doc);
        const placed = markers
          .filter((marker) => marker.offset >= 0 && marker.offset <= map.textLength)
          .map((marker): PlacedMarker => {
            // The start of the paragraph holding the offset, so the marker sits in the margin.
            const $pos = state.doc.resolve(map.toPos(marker.offset));
            return { ...marker, pos: $pos.depth >= 1 ? $pos.start(1) : $pos.pos };
          });
        tr.setMeta(sceneMarkersPluginKey, placed).setMeta("addToHistory", false);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const onSelect = this.options.onSelect;
    return [new Plugin({
      key: sceneMarkersPluginKey,
      state: {
        init: (_, state) => ({ markers: [] as PlacedMarker[], decorations: DecorationSet.empty.map(state.tr.mapping, state.doc) }),
        apply(tr, previous, _old, next) {
          const placed = tr.getMeta(sceneMarkersPluginKey) as PlacedMarker[] | undefined;
          if (placed) return { markers: placed, decorations: markerDecorations(next.doc, placed) };
          if (!tr.docChanged) return previous;
          const markers = previous.markers.map((marker) => ({ ...marker, pos: tr.mapping.map(marker.pos, -1) }));
          return { markers, decorations: previous.decorations.map(tr.mapping, next.doc) };
        },
      },
      props: {
        decorations: (state) => sceneMarkersPluginKey.getState(state)?.decorations,
        handleDOMEvents: {
          mousedown: (_view, event) => {
            const target = (event.target as HTMLElement | null)?.closest?.("[data-scene-marker]") as HTMLElement | null;
            if (!target) return false;
            event.preventDefault();
            onSelect?.(target.dataset.sceneMarker!);
            return true;
          },
        },
      },
    })];
  },
});
