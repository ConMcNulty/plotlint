import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listChapterVersions, readChapterVersion } from "@actalk/inkos-core";
import { chapterFiles } from "./plotlint-chapters.js";

// Agent edits as tracked changes (PLAN, "Suggestions as tracked changes"). InkOS
// writes an agent's revision straight to the chapter file and archives the text it
// replaced as a chapter version. Until the writer has reviewed it, Studio shows the
// newest agent version's text as the base the editor draws the revision against,
// so each change can be accepted or rejected. Reviews are kept in
// `story/plotlint/reviews.json` (`{version: 1, reviewed: {"<chapter>": "<version id>"}}`).

const AGENT_SOURCES = new Set(["agent", "revision", "regeneration"]);

export interface PendingAgentEdit {
  readonly versionId: string;
  readonly source: string;
  readonly createdAt: string;
  /** The chapter as it was before the agent's edit. */
  readonly before: string;
}

interface ReviewsFile {
  readonly version: 1;
  readonly reviewed: Record<string, string>;
}

const reviewsPath = (bookDir: string) => join(bookDir, "story", "plotlint", "reviews.json");

async function loadReviews(bookDir: string): Promise<ReviewsFile> {
  try {
    const parsed = JSON.parse(await readFile(reviewsPath(bookDir), "utf-8")) as Partial<ReviewsFile>;
    return { version: 1, reviewed: parsed.reviewed && typeof parsed.reviewed === "object" ? { ...parsed.reviewed } : {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, reviewed: {} };
    throw error;
  }
}

/** The agent edit to review in `chapter`: the newest version, when an agent made it and it has not been reviewed. */
export async function pendingAgentEdit(bookDir: string, chapter: number): Promise<PendingAgentEdit | null> {
  const [versions, reviews, texts] = await Promise.all([listChapterVersions(bookDir, chapter), loadReviews(bookDir), chapterFiles(bookDir)]);
  const newest = versions[0];
  if (!newest || !AGENT_SOURCES.has(newest.source) || reviews.reviewed[String(chapter)] === newest.id) return null;
  const before = await readChapterVersion(bookDir, chapter, newest.id);
  // Nothing to show when the chapter reads as it did before (the edit was undone by hand).
  if (before === texts.get(chapter)) return null;
  return { versionId: newest.id, source: newest.source, createdAt: newest.createdAt, before };
}

/** Record that the writer has reviewed the agent edit archived as `versionId`. */
export async function markReviewed(bookDir: string, chapter: number, versionId: unknown): Promise<void> {
  if (typeof versionId !== "string" || !versionId) throw new Error("versionId must be a non-empty string");
  const versions = await listChapterVersions(bookDir, chapter);
  if (!versions.some((version) => version.id === versionId)) throw new Error(`chapter ${chapter} has no version ${versionId}`);
  const reviews = await loadReviews(bookDir);
  const path = reviewsPath(bookDir);
  await mkdir(dirname(path), { recursive: true });
  const next: ReviewsFile = { version: 1, reviewed: { ...reviews.reviewed, [String(chapter)]: versionId } };
  await writeFile(`${path}.tmp`, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  await rename(`${path}.tmp`, path);
}
