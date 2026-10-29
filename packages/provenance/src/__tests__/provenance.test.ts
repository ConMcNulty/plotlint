import { describe, expect, it } from "vitest";
import { agentAuthor, humanAuthor, markdownReport, reconcile, recordRevision, spans, summarize, trackedText, withChapter } from "../index.js";

const at = "2026-10-29T00:00:00Z";
const before = "Mira felt that the tide was turning. She walked to the quay.";

describe("provenance", () => {
  it("keeps the authors of words a revision keeps and gives inserted words to the reviser", () => {
    const after = "Mira sensed the tide turning. She walked to the quay.";
    const record = recordRevision(undefined, 1, before, after, { by: agentAuthor("loop-author", "glm-4.5-flash"), at, via: "loop:run1" }, "import");
    expect(trackedText(record)).toBe(after);
    const authored = spans(record).map((span) => [after.slice(span.start, span.end), span.by]);
    expect(authored).toContainEqual(["sensed", "agent:loop-author@glm-4.5-flash"]);
    expect(authored.find(([text]) => text.includes("She walked"))![1]).toBe("import");

    // A person then rewrites the second sentence.
    const human = recordRevision(record, 1, after, "Mira sensed the tide turning. She ran.", { by: humanAuthor("Cob"), at: "2026-10-29T01:00:00Z" });
    const kinds = spans(human).map((span) => span.by);
    expect(kinds).toContain("human:Cob");
    expect(kinds).toContain("agent:loop-author@glm-4.5-flash");
  });

  it("attributes edits made outside the recorders to unknown", () => {
    const record = recordRevision(undefined, 1, before, before, { by: "unknown", at }, "import");
    const edited = before.replace("quay", "harbour wall");
    const reconciled = reconcile(record, 1, edited);
    expect(spans(reconciled).find((span) => edited.slice(span.start, span.end).includes("harbour"))!.by).toBe("unknown");
    // recordRevision from a `before` the record does not know records the gap first.
    const next = recordRevision(record, 1, edited, edited.replace("Mira", "Nell"), { by: humanAuthor(), at });
    expect(trackedText(next)).toBe(edited.replace("Mira", "Nell"));
    expect(new Set(spans(next).map((span) => span.by))).toEqual(new Set(["import", "unknown", "human"]));
  });

  it("summarizes shares per chapter and book and writes a report", () => {
    const one = recordRevision(undefined, 1, before, before.replace("walked to the quay", "ran all the way down to the old quay"), { by: humanAuthor("Cob"), at }, agentAuthor("inkos-writer"));
    const file = withChapter(withChapter({ version: 1, chapters: [] }, one), { chapter: 2, segments: [{ text: "无人知晓。", by: "import", at }] });
    const texts = new Map([[1, trackedText(one)], [2, "无人知晓。"], [3, "A chapter nobody recorded."]]);
    const summary = summarize(file, texts);
    expect(summary.chapters.map((chapter) => chapter.current)).toEqual([true, true, false]);
    expect(summary.chapters[1]!.words).toBe(4);
    expect(summary.byKind.human.words).toBeGreaterThan(0);
    expect(summary.byKind.unknown.words).toBe(4);
    const report = markdownReport(summary, "Lessing Fen", at);
    expect(report).toContain("# Provenance report: Lessing Fen");
    expect(report).toContain("| human:Cob |");
    expect(report).toContain("| 3* |");
  });
});
