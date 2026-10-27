import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@plotlint/diagnostics";
import {
  createDiagnosticsPlugin,
  docToText,
  getDiagnostics,
  OffsetMap,
  PlainTextDocument,
  textToNode,
  withDiagnostics,
} from "../index.js";
import { createEditor, diagnostic, SOURCE } from "./helpers.js";

const WORDS = 10_000;
const DIAGNOSTICS = 500;
const KEYSTROKES = 300;
const layers = ["mechanics", "style", "metrics", "continuity", "structure", "judgment"] as const;

/** A 10k-word chapter: 100 paragraphs of 100 words with a blank line between them. */
function chapter(): string {
  const vocabulary = ["the", "rain", "kept", "falling", "on", "Lin", "Yuan's", "door", "while", "she", "waited", "quietly", "and", "listened."];
  const paragraphs: string[] = [];
  let n = 0;
  for (let p = 0; p < WORDS / 100; p++) {
    const words: string[] = [];
    for (let w = 0; w < 100; w++) words.push(vocabulary[(n++ * 7) % vocabulary.length]!);
    paragraphs.push(words.join(" "));
  }
  return paragraphs.join("\n\n");
}

/** One diagnostic every ~20 words, each on a whole word, layers mixed. */
function findings(text: string): Diagnostic[] {
  const words = [...text.matchAll(/\S+/g)];
  const step = Math.floor(words.length / DIAGNOSTICS);
  return Array.from({ length: DIAGNOSTICS }, (_, i) => {
    const word = words[i * step]!;
    const layer = layers[i % layers.length]!;
    return diagnostic(word.index!, word.index! + word[0].length, {
      ruleId: `${layer}/perf-${i}`,
      layer,
      severity: layer === "judgment" ? "note" : i % 3 === 0 ? "error" : "warning",
      confidence: layer === "judgment" ? "judged" : "deterministic",
    });
  });
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { median: round(pick(0.5)), p95: round(pick(0.95)), max: round(sorted.at(-1)!), mean: round(samples.reduce((a, b) => a + b, 0) / samples.length) };
}

/** Keystroke targets spread over the document, a tenth of them inside a diagnostic. */
function targets(text: string, diagnostics: Diagnostic[]): number[] {
  return Array.from({ length: KEYSTROKES }, (_, i) => {
    if (i % 10 === 0) {
      const range = diagnostics[(i * 13) % diagnostics.length]!.range!;
      return range.start + 1;
    }
    return Math.floor((i / KEYSTROKES) * text.length);
  });
}

describe("performance: 10k words, 500 diagnostics", () => {
  const text = chapter();
  const diagnostics = findings(text);

  it("builds a chapter of the intended size", () => {
    expect(text.split(/\s+/).length).toBe(WORDS);
    expect(diagnostics.length).toBe(DIAGNOSTICS);
  });

  it("applies a typed character to the state (transaction + decoration mapping) well under 100 ms", () => {
    const schema = getSchema(PlainTextDocument);
    let state = EditorState.create({ doc: textToNode(schema, text), plugins: [createDiagnosticsPlugin()] });

    const setStart = performance.now();
    state = state.apply(withDiagnostics(state.tr, diagnostics, { sourceId: SOURCE }));
    const setDiagnosticsMs = performance.now() - setStart;
    expect(getDiagnostics(state).length).toBe(DIAGNOSTICS);

    const samples: number[] = [];
    for (const offset of targets(text, diagnostics)) {
      const pos = OffsetMap.fromDoc(state.doc).toPos(offset);
      const start = performance.now();
      state = state.apply(state.tr.insertText("x", pos));
      samples.push(performance.now() - start);
    }
    const result = stats(samples);
    console.log(`[perf] state only: setDiagnostics ${setDiagnosticsMs.toFixed(2)} ms; keystroke ms`, result);
    expect(getDiagnostics(state).filter((entry) => entry.stale).length).toBeGreaterThan(0);
    expect(result.p95).toBeLessThan(20);
    expect(setDiagnosticsMs).toBeLessThan(200);
  });

  it("dispatches a typed character through the editor view (with DOM update and re-lint tracking) well under 100 ms", () => {
    let changedCalls = 0;
    const editor = createEditor(text, { onChangedRanges: () => { changedCalls++; } });
    expect(docToText(editor.state.doc)).toBe(text);

    const setStart = performance.now();
    editor.commands.setDiagnostics(diagnostics, { sourceId: SOURCE });
    const setDiagnosticsMs = performance.now() - setStart;
    expect(editor.view.dom.querySelectorAll(".pl-diag").length).toBeGreaterThanOrEqual(DIAGNOSTICS);

    const samples: number[] = [];
    for (const offset of targets(text, diagnostics)) {
      const pos = OffsetMap.fromDoc(editor.state.doc).toPos(offset);
      const start = performance.now();
      editor.view.dispatch(editor.state.tr.insertText("x", pos));
      samples.push(performance.now() - start);
    }
    const result = stats(samples);
    console.log(`[perf] editor view (jsdom): setDiagnostics ${setDiagnosticsMs.toFixed(2)} ms; keystroke ms`, result);
    expect(changedCalls).toBeGreaterThanOrEqual(KEYSTROKES);
    expect(editor.storage.diagnostics.changedRanges().ranges.length).toBeGreaterThan(0);
    expect(result.p95).toBeLessThan(50);
    expect(setDiagnosticsMs).toBeLessThan(1000);
    editor.destroy();
  });
});
