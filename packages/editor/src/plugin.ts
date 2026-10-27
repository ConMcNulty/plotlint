import type { Diagnostic } from "@plotlint/diagnostics";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping, type StepMap } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { docToText, OffsetMap, type TextRange } from "./text.js";

/** A diagnostic drawn in the editor, at its current (mapped) ProseMirror range. */
export interface DiagnosticEntry {
  readonly id: string;
  readonly diagnostic: Diagnostic;
  readonly from: number;
  readonly to: number;
  /** The text inside the range was edited since the lint that produced it. */
  readonly stale: boolean;
}

/** A changed paragraph range in current plain-text offsets, whole paragraphs, end exclusive. */
export interface ChangedRange extends TextRange {
  readonly firstBlock: number;
  readonly lastBlock: number;
}

export interface ChangedRanges {
  /** Document version the ranges refer to; pass it to `setDiagnostics` with the lint results. */
  readonly version: number;
  readonly sourceId: string | null;
  readonly ranges: ReadonlyArray<ChangedRange>;
}

export interface SetDiagnosticsOptions {
  /** The source shown in this editor, e.g. `chapter:12`. Diagnostics for other sources are ignored. */
  readonly sourceId: string;
  /**
   * Document version the diagnostics were computed against (from `getLintSnapshot`
   * or `onChangedRanges`). Ranges are mapped through any edits made since. Defaults
   * to the current version. A version older than the kept history is refused.
   */
  readonly version?: number;
  /**
   * Re-lint of part of the text: only diagnostics inside these ranges (in the
   * version's text) are replaced, the rest stay. Omit to replace all diagnostics.
   */
  readonly ranges?: ReadonlyArray<TextRange>;
  /**
   * On a partial re-lint, keep existing diagnostics this returns true for even
   * inside the replaced ranges: findings only a whole-text lint produces (chapter
   * metrics, say) stay drawn, marked stale where edited, until the next full lint.
   */
  readonly keep?: (diagnostic: Diagnostic) => boolean;
}

export interface HoverContext {
  readonly view: EditorView;
  readonly event: MouseEvent | null;
  /** The underlined element under the mouse, to anchor a tooltip. */
  readonly anchor: HTMLElement | null;
}

export interface DiagnosticsPluginOptions {
  /** What happens to a diagnostic whose range is edited into: kept with `pl-diag--stale`, or removed. */
  readonly staleMode?: "mark" | "drop";
  /** How many document versions to keep for mapping late lint results. */
  readonly historyLimit?: number;
  /** Id for each diagnostic; defaults to `<ruleId>:<start>-<end>`, suffixed `#n` on duplicates. */
  readonly getId?: (diagnostic: Diagnostic, index: number) => string;
  /** Called after each edit (and after each lint result) with the paragraphs changed since the last lint. */
  readonly onChangedRanges?: (changed: ChangedRanges, view: EditorView) => void;
  /** Called when the set of diagnostics under the mouse changes (empty when it leaves them). */
  readonly onHover?: (entries: DiagnosticEntry[], context: HoverContext) => void;
  /** Called when the set of diagnostics at the cursor changes. */
  readonly onCursorDiagnostics?: (entries: DiagnosticEntry[], view: EditorView) => void;
}

interface DecorationSpec {
  readonly id: string;
  readonly diagnostic: Diagnostic;
  readonly stale: boolean;
  readonly inclusiveStart: false;
  readonly inclusiveEnd: false;
}

interface DirtyRange {
  readonly from: number;
  readonly to: number;
  /** Version in which the latest edit inside this range was made. */
  readonly version: number;
}

interface Snapshot {
  readonly version: number;
  readonly doc: ProseMirrorNode;
  /** Step maps that led from the previous version to this one. */
  readonly maps: ReadonlyArray<StepMap>;
}

export interface DiagnosticsPluginState {
  readonly sourceId: string | null;
  readonly decorations: DecorationSet;
  /** Increments with every document change. */
  readonly version: number;
  readonly snapshots: ReadonlyArray<Snapshot>;
  readonly dirty: ReadonlyArray<DirtyRange>;
}

type Meta =
  | { readonly type: "set"; readonly diagnostics: ReadonlyArray<Diagnostic>; readonly options: SetDiagnosticsOptions }
  | { readonly type: "clear" }
  | { readonly type: "remove"; readonly ids: ReadonlyArray<string> };

export const diagnosticsPluginKey = new PluginKey<DiagnosticsPluginState>("plotlintDiagnostics");

const DEFAULT_HISTORY_LIMIT = 100;

/** The ProseMirror plugin behind the `Diagnostics` extension, usable without Tiptap. */
export function createDiagnosticsPlugin(options: DiagnosticsPluginOptions = {}): Plugin<DiagnosticsPluginState> {
  const staleMode = options.staleMode ?? "mark";
  const historyLimit = Math.max(1, options.historyLimit ?? DEFAULT_HISTORY_LIMIT);
  const getId = options.getId;
  let hoverIds = "";

  return new Plugin<DiagnosticsPluginState>({
    key: diagnosticsPluginKey,
    state: {
      init: (_config, state) => ({
        sourceId: null,
        decorations: DecorationSet.empty,
        version: 0,
        snapshots: [{ version: 0, doc: state.doc, maps: [] }],
        dirty: [],
      }),
      apply: (tr, previous) => {
        let next = tr.docChanged ? mapThroughTransaction(previous, tr, staleMode, historyLimit) : previous;
        const meta = tr.getMeta(diagnosticsPluginKey) as Meta | undefined;
        if (meta) next = applyMeta(next, meta, tr.doc, staleMode, getId);
        return next;
      },
    },
    props: {
      decorations: (state) => diagnosticsPluginKey.getState(state)?.decorations,
      handleDOMEvents: options.onHover ? {
        mousemove: (view, event) => {
          const target = event.target instanceof Element ? event.target : null;
          const anchor = target?.closest<HTMLElement>(".pl-diag") ?? null;
          const entries = anchor ? diagnosticsAtCoords(view, { left: event.clientX, top: event.clientY }) : [];
          const ids = entries.map((entry) => entry.id).join("\n");
          if (ids !== hoverIds) {
            hoverIds = ids;
            options.onHover!(entries, { view, event, anchor });
          }
          return false;
        },
        mouseleave: (view, event) => {
          if (hoverIds !== "") {
            hoverIds = "";
            options.onHover!([], { view, event, anchor: null });
          }
          return false;
        },
      } : undefined,
    },
    view: (initialView) => {
      let cursorIds = options.onCursorDiagnostics ? entryIds(diagnosticsAt(initialView.state, initialView.state.selection.head)) : "";
      return {
        update: (view, previousState) => {
          const before = diagnosticsPluginKey.getState(previousState);
          const after = diagnosticsPluginKey.getState(view.state);
          if (!after) return;
          if (options.onChangedRanges && before?.dirty !== after.dirty) {
            options.onChangedRanges(changedRanges(view.state), view);
          }
          if (options.onCursorDiagnostics
            && (before?.decorations !== after.decorations || !previousState.selection.eq(view.state.selection))) {
            const entries = diagnosticsAt(view.state, view.state.selection.head);
            const ids = entryIds(entries);
            if (ids !== cursorIds) {
              cursorIds = ids;
              options.onCursorDiagnostics(entries, view);
            }
          }
        },
      };
    },
  });
}

function entryIds(entries: ReadonlyArray<DiagnosticEntry>): string {
  return entries.map((entry) => entry.id).join("\n");
}

/** Map decorations, dirty ranges and the version history through one document-changing transaction. */
function mapThroughTransaction(
  previous: DiagnosticsPluginState,
  tr: Transaction,
  staleMode: "mark" | "drop",
  historyLimit: number,
): DiagnosticsPluginState {
  const maps = tr.mapping.maps;
  const version = previous.version + 1;

  let decorations = previous.decorations;
  for (let index = 0; index < maps.length; index++) {
    const map = maps[index]!;
    const docAfter = tr.docs[index + 1] ?? tr.doc;
    const touched: Decoration[] = [];
    map.forEach((oldStart, oldEnd) => {
      for (const decoration of decorations.find(oldStart, oldEnd)) {
        if ((decoration.spec as DecorationSpec).stale || touched.includes(decoration)) continue;
        if (editsInside(decoration.from, decoration.to, oldStart, oldEnd)) touched.push(decoration);
      }
    });
    if (touched.length) decorations = decorations.remove([...touched]) // remove() nulls out the array it is given;
    decorations = decorations.map(new Mapping([map]), docAfter);
    if (touched.length && staleMode === "mark") {
      const marked: Decoration[] = [];
      for (const decoration of touched) {
        const from = map.map(decoration.from, 1);
        const to = map.map(decoration.to, -1);
        const spec = decoration.spec as DecorationSpec;
        if (from < to) marked.push(diagnosticDecoration(from, to, spec.id, spec.diagnostic, true));
      }
      if (marked.length) decorations = decorations.add(docAfter, marked);
    }
  }

  const dirty: DirtyRange[] = previous.dirty.map((range) => ({
    from: tr.mapping.map(range.from, -1),
    to: tr.mapping.map(range.to, 1),
    version: range.version,
  }));
  maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      dirty.push({ from: rest.map(newStart, -1), to: rest.map(newEnd, 1), version });
    });
  });

  const snapshots = [...previous.snapshots, { version, doc: tr.doc, maps }];
  if (snapshots.length > historyLimit) snapshots.splice(0, snapshots.length - historyLimit);

  return { ...previous, decorations, version, snapshots, dirty: mergeDirty(dirty) };
}

/** Whether a change over [changeStart, changeEnd] (old positions) edits into a range, not just at its edge. */
function editsInside(from: number, to: number, changeStart: number, changeEnd: number): boolean {
  if (changeStart === changeEnd) return from < changeStart && changeStart < to;
  return changeStart < to && changeEnd > from;
}

function mergeDirty(ranges: DirtyRange[]): DirtyRange[] {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: DirtyRange[] = [sorted[0]!];
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (range.from <= last.to) {
      merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, range.to), version: Math.max(last.version, range.version) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function applyMeta(
  state: DiagnosticsPluginState,
  meta: Meta,
  doc: ProseMirrorNode,
  staleMode: "mark" | "drop",
  getId: DiagnosticsPluginOptions["getId"],
): DiagnosticsPluginState {
  if (meta.type === "clear") return { ...state, decorations: DecorationSet.empty };
  if (meta.type === "remove") {
    const ids = new Set(meta.ids);
    const found = state.decorations.find(undefined, undefined, (spec: DecorationSpec) => ids.has(spec.id));
    return found.length ? { ...state, decorations: state.decorations.remove(found) } : state;
  }

  const { sourceId, ranges } = meta.options;
  const baseVersion = meta.options.version ?? state.version;
  const baseIndex = state.snapshots.findIndex((snapshot) => snapshot.version === baseVersion);
  if (baseIndex < 0) return state;
  const baseDoc = state.snapshots[baseIndex]!.doc;
  const laterMaps = state.snapshots.slice(baseIndex + 1).flatMap((snapshot) => snapshot.maps);
  const offsets = OffsetMap.fromDoc(baseDoc);
  const partial = ranges !== undefined && sourceId === state.sourceId;

  // Replaced regions, in current positions.
  const replaced = partial
    ? ranges.map((range) => mapRange(offsets.toPos(range.start), offsets.toPos(range.end), laterMaps))
    : [];

  const seen = new Map<string, number>();
  const added: Decoration[] = [];
  meta.diagnostics.forEach((diagnostic, index) => {
    const range = diagnostic.range;
    if (!range || range.sourceId !== sourceId) return;
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) return;
    if (range.start < 0 || range.end < range.start || range.end > offsets.textLength) return;
    if (partial && !ranges.some((r) => r.start <= range.start && range.end <= r.end)) return;

    let from = offsets.toPos(range.start);
    let to = offsets.toPos(range.end);
    if (from === to) {
      // A zero-width finding (a missing comma) still needs a character to underline.
      const $pos = baseDoc.resolve(from);
      if (!$pos.parent.isTextblock) return;
      if (from < $pos.end()) to = from + 1;
      else if (from > $pos.start()) from -= 1;
      else return;
    }
    const mapped = mapRange(from, to, laterMaps);
    if (mapped.deleted || (mapped.stale && staleMode === "drop")) return;

    let id = getId ? getId(diagnostic, index) : `${diagnostic.ruleId}:${range.start}-${range.end}`;
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}#${count + 1}`;
    added.push(diagnosticDecoration(mapped.from, mapped.to, id, diagnostic, mapped.stale));
  });

  let decorations: DecorationSet;
  let dirty: ReadonlyArray<DirtyRange>;
  if (partial) {
    const { keep } = meta.options;
    const removed = state.decorations.find(undefined, undefined).filter((decoration) =>
      !keep?.((decoration.spec as DecorationSpec).diagnostic) && replaced.some((r) => (decoration.from < r.to && decoration.to > r.from) || (decoration.from >= r.from && decoration.to <= r.to)));
    decorations = state.decorations.remove(removed).add(doc, added);
    dirty = state.dirty.filter((d) => d.version > baseVersion || !replaced.some((r) => r.from <= d.from && d.to <= r.to));
  } else {
    decorations = DecorationSet.create(doc, added);
    dirty = state.dirty.filter((d) => d.version > baseVersion);
  }
  if (dirty.length === state.dirty.length) dirty = state.dirty;
  return { ...state, sourceId, decorations, dirty };
}

/** Map a range through step maps, noting whether an edit landed inside it or deleted it. */
function mapRange(from: number, to: number, maps: ReadonlyArray<StepMap>): { from: number; to: number; stale: boolean; deleted: boolean } {
  let stale = false;
  for (const map of maps) {
    if (!stale) map.forEach((oldStart, oldEnd) => { if (editsInside(from, to, oldStart, oldEnd)) stale = true; });
    from = map.map(from, 1);
    to = Math.max(from, map.map(to, -1));
  }
  return { from, to, stale, deleted: from >= to };
}

function diagnosticDecoration(from: number, to: number, id: string, diagnostic: Diagnostic, stale: boolean): Decoration {
  const classes = ["pl-diag", `pl-diag--${diagnostic.layer}`, `pl-diag--${diagnostic.severity}`, `pl-diag--${diagnostic.confidence}`];
  if (stale) classes.push("pl-diag--stale");
  const spec: DecorationSpec = { id, diagnostic, stale, inclusiveStart: false, inclusiveEnd: false };
  return Decoration.inline(from, to, { class: classes.join(" "), "data-diagnostic-id": id }, spec);
}

function toEntry(decoration: Decoration): DiagnosticEntry {
  const spec = decoration.spec as DecorationSpec;
  return { id: spec.id, diagnostic: spec.diagnostic, from: decoration.from, to: decoration.to, stale: spec.stale };
}

/** Set (replace or partly replace) the diagnostics on a transaction. */
export function withDiagnostics(tr: Transaction, diagnostics: ReadonlyArray<Diagnostic>, options: SetDiagnosticsOptions): Transaction {
  const meta: Meta = { type: "set", diagnostics, options };
  return tr.setMeta(diagnosticsPluginKey, meta).setMeta("addToHistory", false);
}

/** Remove all diagnostics on a transaction. */
export function withoutDiagnostics(tr: Transaction): Transaction {
  const meta: Meta = { type: "clear" };
  return tr.setMeta(diagnosticsPluginKey, meta).setMeta("addToHistory", false);
}

/**
 * Apply fix `fixIndex` of diagnostic `id` to `tr`: replace the diagnostic's current
 * range with the fix's replacement ("\n" splits paragraphs). Returns false, leaving
 * `tr` untouched, when the diagnostic is missing, stale or has no such fix.
 */
export function applyFixToTransaction(state: EditorState, tr: Transaction, id: string, fixIndex = 0): boolean {
  const entry = findDiagnostic(state, id);
  const fix = entry?.diagnostic.fixes?.[fixIndex];
  if (!entry || entry.stale || !fix) return false;
  const from = tr.mapping.map(entry.from, 1);
  const to = tr.mapping.map(entry.to, -1);
  if (from > to) return false;
  tr.delete(from, to);
  let pos = from;
  fix.replacement.split("\n").forEach((part, index) => {
    if (index > 0) {
      tr.split(pos);
      pos += 2;
    }
    if (part) {
      tr.insertText(part, pos);
      pos += part.length;
    }
  });
  const meta: Meta = { type: "remove", ids: [id] };
  tr.setMeta(diagnosticsPluginKey, meta);
  return true;
}

export function getDiagnosticsState(state: EditorState): DiagnosticsPluginState | undefined {
  return diagnosticsPluginKey.getState(state);
}

/** All diagnostics drawn in the editor, in document order. */
export function getDiagnostics(state: EditorState): DiagnosticEntry[] {
  const decorations = getDiagnosticsState(state)?.decorations;
  if (!decorations) return [];
  return decorations.find().map(toEntry).sort((a, b) => a.from - b.from || a.to - b.to);
}

export function findDiagnostic(state: EditorState, id: string): DiagnosticEntry | undefined {
  const found = getDiagnosticsState(state)?.decorations.find(undefined, undefined, (spec: DecorationSpec) => spec.id === id);
  return found?.[0] ? toEntry(found[0]) : undefined;
}

/** Diagnostics whose range contains or touches ProseMirror position `pos`. */
export function diagnosticsAt(state: EditorState, pos: number): DiagnosticEntry[] {
  const decorations = getDiagnosticsState(state)?.decorations;
  if (!decorations) return [];
  return decorations.find(pos, pos).map(toEntry).sort((a, b) => a.from - b.from || a.to - b.to);
}

/** Diagnostics under viewport coordinates, e.g. a mouse event's clientX/clientY. */
export function diagnosticsAtCoords(view: EditorView, coords: { left: number; top: number }): DiagnosticEntry[] {
  const found = view.posAtCoords(coords);
  return found ? diagnosticsAt(view.state, found.pos) : [];
}

/** Paragraphs changed since the last lint, as merged whole-paragraph plain-text ranges. */
export function changedRanges(state: EditorState): ChangedRanges {
  const plugin = getDiagnosticsState(state);
  if (!plugin) return { version: 0, sourceId: null, ranges: [] };
  if (!plugin.dirty.length) return { version: plugin.version, sourceId: plugin.sourceId, ranges: [] };
  const offsets = OffsetMap.fromDoc(state.doc);
  const ranges: ChangedRange[] = [];
  for (const dirty of plugin.dirty) {
    const range = offsets.paragraphRange({ start: offsets.toOffset(dirty.from), end: offsets.toOffset(dirty.to) });
    const last = ranges[ranges.length - 1];
    if (last && range.firstBlock <= last.lastBlock + 1) {
      ranges[ranges.length - 1] = { start: last.start, end: Math.max(last.end, range.end), firstBlock: last.firstBlock, lastBlock: Math.max(last.lastBlock, range.lastBlock) };
    } else {
      ranges.push(range);
    }
  }
  return { version: plugin.version, sourceId: plugin.sourceId, ranges };
}

/** What a linter needs: the current text, its version and the paragraphs changed since the last lint. */
export function getLintSnapshot(state: EditorState): ChangedRanges & { readonly text: string } {
  return { ...changedRanges(state), text: docToText(state.doc) };
}
