import { humanAuthor, spans, summarize, trackedText, reconcile, type AuthoredSpan, type ProvenanceSummary } from "@plotlint/provenance";
import { baselineAuthor, loadProvenance, recordChapterRevision } from "@plotlint/provenance/node";
import { chapterFiles } from "./plotlint-chapters.js";

// Provenance for Studio: a save from the chapter editor is the writer's own edit, and
// the provenance route tells the editor and the book page who wrote what.

/**
 * Record a Studio save as the writer's edit. `before` is the file's text before the save
 * (undefined for a new chapter); `indexProvenance` is InkOS's label for where the text
 * came from, which attributes it when the chapter has no record yet.
 */
export async function recordStudioEdit(bookDir: string, chapter: number, before: string | undefined, indexProvenance?: string): Promise<void> {
  const after = (await chapterFiles(bookDir)).get(chapter);
  if (after === undefined || after === before) return;
  await recordChapterRevision(bookDir, chapter, before ?? "", after,
    { by: humanAuthor(), at: new Date().toISOString(), via: "studio" }, baselineAuthor(indexProvenance));
}

export interface ChapterProvenanceView {
  readonly chapter: number;
  /** Who wrote each stretch of the chapter as it is on disk; untracked changes are unknown. */
  readonly spans: AuthoredSpan[];
  readonly current: boolean;
}

/** The book's provenance summary, and the spans of one chapter when asked for. */
export async function provenanceView(bookDir: string, chapter?: number): Promise<{ summary: ProvenanceSummary; chapter?: ChapterProvenanceView }> {
  const [file, texts] = await Promise.all([loadProvenance(bookDir), chapterFiles(bookDir)]);
  const summary = summarize(file, texts);
  if (chapter === undefined || !texts.has(chapter)) return { summary };
  const stored = file.chapters.find((entry) => entry.chapter === chapter);
  const text = texts.get(chapter)!;
  return { summary, chapter: { chapter, spans: spans(reconcile(stored, chapter, text)), current: stored !== undefined && trackedText(stored) === text } };
}
