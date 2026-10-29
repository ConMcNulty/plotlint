import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ProvenanceFileSchema, recordRevision, withChapter, type AuthorId, type Change, type ProvenanceFile } from "./index.js";

/** `<bookDir>/story/plotlint/provenance.json`. */
export const provenancePath = (bookDir: string) => join(bookDir, "story", "plotlint", "provenance.json");

export async function loadProvenance(bookDir: string): Promise<ProvenanceFile> {
  try {
    return ProvenanceFileSchema.parse(JSON.parse(await readFile(provenancePath(bookDir), "utf-8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, chapters: [] };
    throw error;
  }
}

/** Written to a temporary file and renamed, so an interrupted write never leaves half a record. */
export async function saveProvenance(bookDir: string, file: ProvenanceFile): Promise<void> {
  const path = provenancePath(bookDir);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ProvenanceFileSchema.parse(file), null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

/** Load the book's record, record one chapter's revision, and save it. */
export async function recordChapterRevision(bookDir: string, chapter: number, before: string, after: string, change: Change, baseline: AuthorId = "unknown"): Promise<void> {
  const file = await loadProvenance(bookDir);
  const record = file.chapters.find((entry) => entry.chapter === chapter);
  await saveProvenance(bookDir, withChapter(file, recordRevision(record, chapter, before, after, change, baseline)));
}

/** The author of a chapter's text before any record, from InkOS's chapter index (`provenance`). */
export function baselineAuthor(provenance: string | undefined): AuthorId {
  return provenance === "generated" ? "agent:inkos-writer" : provenance === "imported" ? "import" : "unknown";
}
