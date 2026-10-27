// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OffsetMap, type DiagnosticEntry } from "@plotlint/editor";
import { createChapterEditor, editedAway, type ChapterEditor } from "../chapter-editor";
import type { LintDiagnostic, LintRequest, LintResponse } from "../lint-client";
import { verdictBody, type VerdictEvent } from "../verdict-client";

const SOURCE = "chapter:3";

/** A finding per "teh" (spelling) and per "very" (style), fingerprinted by the word and its paragraph's first word. */
function finding(text: string, start: number, word: string): LintDiagnostic {
  const lineStart = text.lastIndexOf("\n", start) + 1;
  const style = word === "very";
  return {
    code: style ? "intensifier" : "spelling",
    ruleId: style ? "style/general.Intensifiers" : "mechanics/harper",
    layer: style ? "style" : "mechanics",
    severity: "warning",
    confidence: "deterministic",
    category: "quality",
    assessment: "issue",
    chapter: 3,
    summary: style ? "Intensifier" : "Did you mean \"the\"?",
    evidence: [`"${word}"`],
    range: { sourceId: SOURCE, start, end: start + word.length },
    ...(style ? {} : { fixes: [{ title: "Replace with \"the\"", replacement: "the" }] }),
    fingerprint: `${word}@${text.slice(lineStart, text.indexOf(" ", lineStart))}`,
  } as LintDiagnostic;
}

const continuity = {
  code: "dead-entity-acts", ruleId: "continuity/dead-entity-acts", layer: "continuity", severity: "error",
  confidence: "extracted", category: "quality", assessment: "issue", chapter: 3,
  summary: "Mira acts after her death", evidence: ["Mira status dead (ch2)"], fingerprint: "fp-state",
} as LintDiagnostic;

function fakeLinter() {
  return vi.fn(async (request: LintRequest): Promise<LintResponse> => {
    const ranges = request.ranges ?? [{ start: 0, end: request.text.length }];
    const diagnostics: LintDiagnostic[] = [];
    for (const range of ranges) {
      for (const match of request.text.slice(range.start, range.end).matchAll(/\b(teh|very)\b/g)) {
        diagnostics.push(finding(request.text, range.start + match.index, match[1]!));
      }
    }
    return { sourceId: SOURCE, diagnostics: [...diagnostics, continuity], ranges: request.ranges ? [...request.ranges] : null, suppressed: 0, stateMissing: false };
  });
}

const TEXT = "# Chapter 3\n\nOne teh harbour was very quiet.\n\nTwo saw teh boat.\n";

// A quick fix focuses the editor, which scrolls the selection into view a frame
// later; jsdom has no layout, so give ranges empty rectangles.
beforeAll(() => {
  const empty = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects ??= empty;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

let controller: ChapterEditor | undefined;
afterEach(() => {
  controller?.destroy();
  controller = undefined;
  document.body.innerHTML = "";
});

function open(hidden?: Set<string>) {
  const lint = fakeLinter();
  const verdicts: VerdictEvent[] = [];
  const element = document.createElement("div");
  document.body.append(element);
  controller = createChapterEditor({
    element, text: TEXT, sourceId: SOURCE, lint, debounceMs: 5, onVerdicts: (events) => verdicts.push(...events), ...(hidden ? { hidden } : {}),
  });
  return { editor: controller, lint, verdicts };
}

const posOf = (editor: ChapterEditor, offset: number) => OffsetMap.fromDoc(editor.editor.state.doc).toPos(offset);
const fingerprintOf = (entry: DiagnosticEntry) => (entry.diagnostic as LintDiagnostic).fingerprint;
const summary = (events: VerdictEvent[]) => events.map((event) => [event.action, event.diagnostic.fingerprint]);

/** Type `insert` at a plain-text offset and wait for the re-lint of that paragraph. */
async function typeAt(editor: ChapterEditor, lint: ReturnType<typeof fakeLinter>, offset: number, insert: string) {
  const calls = lint.mock.calls.length;
  editor.editor.chain().insertContentAt(posOf(editor, offset), insert).run();
  await vi.waitFor(() => expect(lint.mock.calls.length).toBeGreaterThan(calls));
  await editor.flush();
}

describe("chapter editor verdicts", () => {
  it("logs an applied quick fix as accepted, and the re-lint does not count it again", async () => {
    const { editor, lint, verdicts } = open();
    await editor.flush();
    const typo = editor.problems().ranged.find((entry) => entry.diagnostic.ruleId === "mechanics/harper")!;
    expect(editor.applyFix(typo.id, 0)).toBe(true);
    await vi.waitFor(() => expect(lint).toHaveBeenCalledTimes(2));
    await editor.flush();
    expect(summary(verdicts)).toEqual([["fix", "teh@One"]]);
  });

  it("logs a finding the writer edited away, once", async () => {
    const { editor, lint, verdicts } = open();
    await editor.flush();
    // "teh" -> "tueh": typed inside the flagged word, and the re-lint no longer flags it.
    await typeAt(editor, lint, TEXT.indexOf("teh harbour") + 1, "u");
    expect(summary(verdicts)).toEqual([["edited", "teh@One"]]);
    // The intensifier in the same paragraph was re-linted but not edited, so it is not counted.
    await typeAt(editor, lint, editor.getText().indexOf("quiet"), "so ");
    expect(summary(verdicts)).toEqual([["edited", "teh@One"]]);
  });

  it("does not count an edit that leaves the same rule flagging the same text", async () => {
    const { editor, lint, verdicts } = open();
    await editor.flush();
    // "very" -> "vvery" -> still not "very", but typing "very" again right there keeps the style rule on it.
    const at = TEXT.indexOf("very quiet");
    editor.editor.chain().insertContentAt({ from: posOf(editor, at + 1), to: posOf(editor, at + 4) }, "ery very").run();
    await vi.waitFor(() => expect(lint).toHaveBeenCalledTimes(2));
    await editor.flush();
    expect(editor.getText()).toContain("very very quiet");
    expect(verdicts).toEqual([]);
  });

  it("hides a finding for the session, in this editor and in the next one sharing the set", async () => {
    const hidden = new Set<string>();
    const { editor } = open(hidden);
    await editor.flush();
    const typo = editor.problems().ranged.find((entry) => fingerprintOf(entry) === "teh@Two")!;
    editor.hide(typo.diagnostic as LintDiagnostic);
    expect(editor.problems().ranged.map(fingerprintOf)).toEqual(["teh@One", "very@One"]);
    await editor.relintAll();
    expect(editor.problems().ranged.map(fingerprintOf)).toEqual(["teh@One", "very@One"]);
    editor.hide(continuity);
    expect(editor.problems().unranged).toEqual([]);
    editor.destroy();

    const reopened = open(hidden).editor;
    await reopened.flush();
    expect(reopened.problems().ranged.map(fingerprintOf)).toEqual(["teh@One", "very@One"]);
    expect(hidden).toEqual(new Set(["teh@Two", "fp-state"]));
  });
});

describe("editedAway", () => {
  const entry = (id: string, ruleId: string, fingerprint: string, from: number, to: number, stale: boolean): DiagnosticEntry =>
    ({ id, from, to, stale, diagnostic: { ruleId, fingerprint } as unknown as LintDiagnostic });

  it("needs a stale finding that is gone, with nothing of its rule or fingerprint left on its text", () => {
    const before = [
      entry("a", "mechanics/harper", "fa", 1, 4, true),
      entry("b", "mechanics/harper", "fb", 10, 14, false), // not edited
      entry("c", "style/x", "fc", 20, 24, true), // replaced by the same rule nearby
      entry("d", "style/x", "fd", 30, 34, true), // its fingerprint is still drawn elsewhere
      entry("e", "style/y", "fe", 40, 44, true), // still there under the same id
    ];
    const after = [
      entry("c2", "style/x", "fc2", 24, 26, false),
      entry("d2", "style/x", "fd", 50, 54, false),
      entry("e", "style/y", "fe", 40, 44, true),
      entry("f", "style/z", "ff", 2, 3, false), // another rule's finding on a's text does not count against it
    ];
    expect(editedAway(before, after).map((d) => (d as LintDiagnostic).fingerprint)).toEqual(["fa"]);
    // The same rule still flagging a's text means the edit did not take the finding away.
    const reflagged = [...after, entry("g", "mechanics/harper", "fg", 3, 5, false)];
    expect(editedAway(before, reflagged)).toEqual([]);
  });
});

describe("verdictBody", () => {
  it("sends what the server needs, and the verdict the action implies", () => {
    const typo = finding(TEXT, TEXT.indexOf("teh"), "teh");
    expect(verdictBody("book", [{ diagnostic: typo, action: "not-useful" }, { diagnostic: continuity, action: "fix" }])).toEqual({
      bookId: "book",
      verdicts: [
        { ruleId: "mechanics/harper", fingerprint: "teh@One", chapter: 3, verdict: "rejected", action: "not-useful", quote: "Did you mean \"the\"?", layer: "mechanics", confidence: "deterministic" },
        { ruleId: "continuity/dead-entity-acts", fingerprint: "fp-state", chapter: 3, verdict: "accepted", action: "fix", quote: "Mira acts after her death", layer: "continuity", confidence: "extracted" },
      ],
    });
  });
});
