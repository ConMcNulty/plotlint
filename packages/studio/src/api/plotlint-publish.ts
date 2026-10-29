import { loadRuntimeStateSnapshot, type RuntimeStateSnapshot, type StateManager } from "@actalk/inkos-core";
import { manuscriptDocx, outline, parseChapter, roundedWordCount, manuscriptWords } from "@plotlint/export";
import { markdownReport, seedChapters, summarize } from "@plotlint/provenance";
import { baselineAuthor, loadProvenance } from "@plotlint/provenance/node";
import { diffBranches, type BranchDiff } from "@plotlint/rules";
import { branchId, createBranch, listBranches, parseBranchName, workExists, type BranchInfo } from "@plotlint/rules/node";
import { chapterFiles } from "./plotlint-chapters.js";

// Studio's side of phase 6 exports and what-if branches: list, create and compare
// branches (adopting one stays on the command line, since it replaces the book), and
// download the manuscript, the outline and the provenance report.

async function snapshotOf(bookDir: string): Promise<RuntimeStateSnapshot | undefined> {
  try {
    return await loadRuntimeStateSnapshot(bookDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function bookTitle(state: StateManager, bookId: string): Promise<{ title: string; language: "en" | "zh" }> {
  try {
    const config = await state.loadBookConfig(bookId);
    return { title: config.title, language: config.language };
  } catch {
    return { title: bookId, language: "en" };
  }
}

export interface BranchesView {
  readonly bookId: string;
  readonly branches: BranchInfo[];
}

export async function branchesView(root: string, bookId: string): Promise<BranchesView> {
  return { bookId, branches: await listBranches(root, bookId) };
}

export async function newBranch(root: string, bookId: string, name: unknown): Promise<{ id: string }> {
  if (typeof name !== "string") throw new Error("name must be a string");
  return { id: await createBranch(root, bookId, parseBranchName(name)) };
}

export async function branchDiff(root: string, state: StateManager, bookId: string, name: string): Promise<BranchDiff & { branchId: string }> {
  const id = branchId(bookId, parseBranchName(name));
  if (!await workExists(root, id)) throw new Error(`"${bookId}" has no branch "${name}"`);
  const side = async (book: string) => {
    const dir = state.bookDir(book);
    const snapshot = await snapshotOf(dir);
    return { texts: await chapterFiles(dir), ...(snapshot ? { snapshot } : {}) };
  };
  return { branchId: id, ...diffBranches(await side(bookId), await side(id)) };
}

export interface ManuscriptRequest {
  readonly author: string;
  readonly byline?: string;
  readonly contact?: ReadonlyArray<string>;
}

export async function manuscriptFile(state: StateManager, bookId: string, request: ManuscriptRequest): Promise<{ bytes: Uint8Array<ArrayBuffer>; fileName: string; words: number }> {
  if (!request.author.trim()) throw new Error("author is required: the manuscript's contact block needs your name");
  const texts = await chapterFiles(state.bookDir(bookId));
  const chapters = [...texts].map(([number, text]) => parseChapter(number, text));
  if (!chapters.length) throw new Error(`"${bookId}" has no chapters`);
  const { title } = await bookTitle(state, bookId);
  const buffer = await manuscriptDocx({
    title,
    author: { name: request.author.trim(), ...(request.byline?.trim() ? { byline: request.byline.trim() } : {}), ...(request.contact?.length ? { contact: request.contact } : {}) },
    chapters,
  });
  return { bytes: Uint8Array.from(buffer), fileName: `${bookId}-manuscript.docx`, words: manuscriptWords(chapters) };
}

export async function outlineFile(state: StateManager, bookId: string): Promise<{ text: string; fileName: string }> {
  const dir = state.bookDir(bookId);
  const [{ title, language }, snapshot, texts] = await Promise.all([bookTitle(state, bookId), snapshotOf(dir), chapterFiles(dir)]);
  const words = manuscriptWords([...texts].map(([number, text]) => parseChapter(number, text)));
  return { text: outline({ title, language, words: roundedWordCount(words), summaries: snapshot?.chapterSummaries.rows ?? [] }), fileName: `${bookId}-outline.md` };
}

export async function provenanceFile(state: StateManager, bookId: string): Promise<{ text: string; fileName: string }> {
  const dir = state.bookDir(bookId);
  const [{ title }, texts, file, index] = await Promise.all([
    bookTitle(state, bookId), chapterFiles(dir), loadProvenance(dir), state.loadChapterIndex(bookId).catch(() => []),
  ]);
  const origin = new Map(index.map((entry) => [entry.number, baselineAuthor(entry.provenance)]));
  const seeded = seedChapters(file, texts, (chapter) => origin.get(chapter) ?? "unknown");
  return { text: markdownReport(summarize(seeded, texts), title), fileName: `${bookId}-provenance.md` };
}
