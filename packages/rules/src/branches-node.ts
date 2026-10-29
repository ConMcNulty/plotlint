import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WorkManifestSchema, workDirectory, workManifestPath } from "@actalk/inkos-core";

// What-if branches on disk: a branch is a copy of the book's work as a work of its
// own (`<book>--<name>`), marked in its work.json metadata, so InkOS writes,
// settles and audits it like any book. Used by `inkos lint branch` and Studio.

export const BRANCH_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/u;
export const branchId = (bookId: string, name: string) => `${bookId}--${name}`;

export interface BranchInfo {
  readonly name: string;
  /** The branch's own book id. */
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
}

export function parseBranchName(name: string): string {
  if (!BRANCH_NAME.test(name)) throw new Error(`branch names are lowercase letters, digits and dashes (up to 40); got "${name}"`);
  return name;
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function workExists(root: string, id: string): Promise<boolean> {
  return (await readJson(workManifestPath(root, id))) !== undefined;
}

/** Copy a work to a new id and give the copy its own id and title, in work.json and book.json. */
export async function copyWork(root: string, from: string, to: string, title: (old: string) => string, metadata: Record<string, unknown>): Promise<void> {
  const target = workDirectory(root, to);
  if (await workExists(root, to)) throw new Error(`"${to}" already exists`);
  await cp(workDirectory(root, from), target, { recursive: true, errorOnExist: true });
  const now = new Date().toISOString();
  const manifest = WorkManifestSchema.parse(await readJson(workManifestPath(root, to)));
  await writeFile(workManifestPath(root, to), `${JSON.stringify({
    ...manifest, id: to, title: title(manifest.title), updatedAt: now,
    lineage: [...manifest.lineage.filter((entry) => entry.sourceWorkId !== from), { relation: "derived-from", sourceWorkId: from }],
    metadata: { ...manifest.metadata, ...metadata },
  }, null, 2)}\n`, "utf-8");
  const bookJson = join(target, "source", "book.json");
  const book = await readJson(bookJson);
  if (book) await writeFile(bookJson, `${JSON.stringify({ ...book, id: to, title: title(String(book.title ?? manifest.title)), updatedAt: now }, null, 2)}\n`, "utf-8");
}

/** Branch a book as it is now; returns the branch's book id. */
export async function createBranch(root: string, bookId: string, name: string): Promise<string> {
  const id = branchId(bookId, parseBranchName(name));
  await copyWork(root, bookId, id, (title) => `${title} (${name})`, { plotlintBranchOf: bookId, plotlintBranch: name, plotlintBranchedAt: new Date().toISOString() });
  return id;
}

/** The book's branches, oldest first. */
export async function listBranches(root: string, bookId: string): Promise<BranchInfo[]> {
  let ids: string[];
  try {
    ids = await readdir(join(root, "works"));
  } catch {
    return [];
  }
  const out: BranchInfo[] = [];
  for (const id of ids) {
    const manifest = await readJson(workManifestPath(root, id)).catch(() => undefined);
    const meta = (manifest?.metadata ?? {}) as Record<string, unknown>;
    if (meta.plotlintBranchOf === bookId && typeof meta.plotlintBranch === "string") {
      out.push({ name: meta.plotlintBranch, id, title: String(manifest!.title), createdAt: String(meta.plotlintBranchedAt ?? manifest!.createdAt) });
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
