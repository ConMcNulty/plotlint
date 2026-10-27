import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ChapterTexts } from "@plotlint/rules";

// Chapter files for the plotlint routes, cached per book until a file changes.

interface ChapterFiles {
  readonly key: string;
  readonly texts: ChapterTexts;
}

const chapterCaches = new Map<string, ChapterFiles>();

/** `0003_Midnight.md` → 3; other files are not chapters. */
const chapterNumberOf = (file: string): number | null => {
  const match = /^(\d+).*\.md$/.exec(file);
  return match ? Number(match[1]) : null;
};

/** Every chapter file's text by number, re-read only when a file is added, removed or changed. */
export async function chapterFiles(bookDir: string): Promise<ChapterTexts> {
  const dir = join(bookDir, "chapters");
  let files: string[];
  try {
    files = (await readdir(dir)).filter((file) => chapterNumberOf(file) !== null).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const stamps = await Promise.all(files.map(async (file) => {
    const info = await stat(join(dir, file));
    return `${file}:${info.mtimeMs}:${info.size}`;
  }));
  const key = stamps.join("|");
  const cached = chapterCaches.get(bookDir);
  if (cached?.key === key) return cached.texts;

  const texts = new Map<number, string>();
  // Like the chapter route, the first file (by name) for a number wins.
  for (const file of files) {
    const number = chapterNumberOf(file)!;
    if (!texts.has(number)) texts.set(number, await readFile(join(dir, file), "utf-8"));
  }
  chapterCaches.set(bookDir, { key, texts });
  return texts;
}

/** The chapter texts, with the open chapter's unsaved text in place of its file. */
export async function chapterTexts(bookDir: string, open?: { chapter: number; text: string }): Promise<ChapterTexts> {
  const texts = await chapterFiles(bookDir);
  if (!open || texts.get(open.chapter) === open.text) return texts;
  return new Map(texts).set(open.chapter, open.text);
}
