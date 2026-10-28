import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CurrentStateFact } from "@actalk/inkos-core";
import { loadBookRuleData } from "../node.js";
import type { CleanBook } from "./mutant.js";

// A corpus book on disk, beside the package:
//   eval/corpus/<book>/chapters/NNNN_Title.md   the clean chapters
//   eval/corpus/<book>/facts.json               oracle facts: { version: 1, facts: [...] } (optional)
//   eval/corpus/<book>/extracted/<model>/       a real settler's state and scene annotations
//   eval/corpus/<book>/story/plotlint/*.json    book data (travel graph, invariants), read like a real book's

/** `packages/rules/eval/corpus`, from `src/eval` or `dist/eval` alike. */
export const corpusRoot = fileURLToPath(new URL("../../eval/corpus/", import.meta.url));

export async function loadCorpusBook(name: string, root = corpusRoot): Promise<CleanBook> {
  const dir = join(root, name);
  const chapters = new Map<number, string>();
  for (const file of (await readdir(join(dir, "chapters"))).filter((f) => /^\d{4}_.*\.md$/u.test(f)).sort()) {
    // Normalise line endings so offsets and cache keys match on Windows checkouts.
    chapters.set(Number(file.slice(0, 4)), (await readFile(join(dir, "chapters", file), "utf-8")).replace(/\r\n/gu, "\n"));
  }
  // A book with only a real settler's state (extracted/) has no oracle facts.
  const raw = await readFile(join(dir, "facts.json"), "utf-8").catch(() => '{ "facts": [] }');
  const { facts } = JSON.parse(raw) as { facts: CurrentStateFact[] };
  return { name, chapters, facts, book: await loadBookRuleData(dir) };
}
