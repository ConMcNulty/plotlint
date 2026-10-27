import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SuppressionFileSchema, type Suppression, type SuppressionFile } from "@plotlint/diagnostics";

/**
 * Per-book plotlint suppressions live beside the book's story state, at
 * `works/<id>/source/story/plotlint/suppressions.json`, so they travel with the
 * book and every agent or editor that reads the book sees the same list.
 */
export function suppressionsPath(bookDir: string): string {
  return join(bookDir, "story", "plotlint", "suppressions.json");
}

/** Read a book's suppressions; a book without the file has none. */
export async function loadSuppressions(bookDir: string): Promise<SuppressionFile> {
  const path = suppressionsPath(bookDir);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, suppressions: [] };
    throw error;
  }
  const parsed = SuppressionFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`Invalid suppressions file ${path}: ${parsed.error.message}`);
  return parsed.data;
}

/** Write a book's suppressions through a temporary file so a crash never leaves half a file. */
export async function saveSuppressions(bookDir: string, file: SuppressionFile): Promise<void> {
  const path = suppressionsPath(bookDir);
  const valid = SuppressionFileSchema.parse(file);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

const sameTarget = (a: Suppression, b: Suppression) =>
  a.kind === b.kind && a.ruleId === b.ruleId
  && (a.kind === "rule" || (b.kind === "instance" && a.fingerprint === b.fingerprint));

/** Add a suppression, replacing one for the same rule or instance so its reason can be updated. */
export async function addSuppression(bookDir: string, suppression: Suppression): Promise<{ replaced: boolean }> {
  const file = await loadSuppressions(bookDir);
  const rest = file.suppressions.filter((existing) => !sameTarget(existing, suppression));
  await saveSuppressions(bookDir, { version: 1, suppressions: [...rest, suppression] });
  return { replaced: rest.length !== file.suppressions.length };
}

/**
 * Remove suppressions of `ruleId`: the rule-wide one by default, one instance when
 * `fingerprint` is given, or every suppression of the rule with `all`.
 */
export async function removeSuppressions(
  bookDir: string,
  target: { ruleId: string; fingerprint?: string; all?: boolean },
): Promise<Suppression[]> {
  const file = await loadSuppressions(bookDir);
  const matches = (suppression: Suppression) => suppression.ruleId === target.ruleId && (
    target.all
    || (target.fingerprint === undefined
      ? suppression.kind === "rule"
      : suppression.kind === "instance" && suppression.fingerprint === target.fingerprint));
  const removed = file.suppressions.filter(matches);
  if (removed.length > 0) {
    await saveSuppressions(bookDir, { version: 1, suppressions: file.suppressions.filter((s) => !matches(s)) });
  }
  return removed;
}
