import { appendFile, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SuppressionFileSchema, type Suppression, type SuppressionFile } from "./index.js";
import { formatVerdictLine, parseVerdictLines, type ParsedVerdicts, type Verdict } from "./verdicts.js";

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

/**
 * Human verdicts on findings live beside the suppressions, at
 * `works/<id>/source/story/plotlint/verdicts.jsonl`: append-only JSON lines, so
 * concurrent writers (Studio, the CLI, an agent) only ever add whole lines.
 * The file stays in the writer's project and leaves it only when they share it.
 */
export function verdictsPath(bookDir: string): string {
  return join(bookDir, "story", "plotlint", "verdicts.jsonl");
}

/** Read a book's verdicts; a book without the file has none, and bad lines are skipped and reported. */
export async function loadVerdicts(bookDir: string): Promise<ParsedVerdicts> {
  let raw: string;
  try {
    raw = await readFile(verdictsPath(bookDir), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { verdicts: [], skipped: [] };
    throw error;
  }
  return parseVerdictLines(raw);
}

/** Whether the file is missing, empty or ends with a newline, so an append starts on a line of its own. */
async function endsCleanly(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return true;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] === 0x0a;
  } finally {
    await handle.close();
  }
}

/** Validate and append verdicts as whole lines; a torn last line from a crash is closed off first. */
export async function appendVerdicts(bookDir: string, verdicts: ReadonlyArray<Verdict>): Promise<void> {
  if (verdicts.length === 0) return;
  const lines = verdicts.map(formatVerdictLine).join("");
  const path = verdictsPath(bookDir);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, (await endsCleanly(path)) ? lines : `\n${lines}`, "utf-8");
}
