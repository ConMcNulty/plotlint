import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { FramesFileSchema, RuleConfigFileSchema, type BookRuleData } from "./book.js";
import { InvariantsFileSchema } from "./invariants.js";

/** A book's plotlint folder, beside its story state: `works/<id>/source/story/plotlint/`. */
export const plotlintDir = (bookDir: string) => join(bookDir, "story", "plotlint");

/** Read and validate one plotlint JSON file; a missing file is undefined, a malformed one an error. */
export async function readPlotlintFile<S extends z.ZodTypeAny>(bookDir: string, name: string, schema: S): Promise<z.infer<S> | undefined> {
  const path = join(plotlintDir(bookDir), name);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${(error as Error).message}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error(`Invalid ${name} at ${path}: ${parsed.error.message}`);
  return parsed.data;
}

/** Everything the rule engine reads from a book's plotlint folder: `rules.json` and `frames.json`. */
export async function loadBookRuleData(bookDir: string): Promise<BookRuleData> {
  const [config, frames, invariants] = await Promise.all([
    readPlotlintFile(bookDir, "rules.json", RuleConfigFileSchema),
    readPlotlintFile(bookDir, "frames.json", FramesFileSchema),
    readPlotlintFile(bookDir, "invariants.json", InvariantsFileSchema),
  ]);
  return { ...(config ? { config } : {}), ...(frames ? { frames } : {}), ...(invariants ? { invariants } : {}) };
}

/** Validate and write one plotlint JSON file, creating the folder; returns its path. */
export async function writePlotlintFile<S extends z.ZodTypeAny>(bookDir: string, name: string, schema: S, data: z.input<S>): Promise<string> {
  const parsed = schema.parse(data);
  await mkdir(plotlintDir(bookDir), { recursive: true });
  const path = join(plotlintDir(bookDir), name);
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  return path;
}
