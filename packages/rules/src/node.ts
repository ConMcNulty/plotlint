import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { loadVerdicts } from "@plotlint/diagnostics/node";
import { adaptiveOverlay, type AdaptiveOptions } from "./adaptive.js";
import { FramesFileSchema, RuleConfigFileSchema, type BookRuleData, type RuleConfigFile } from "./book.js";
import { InvariantsFileSchema } from "./invariants.js";
import { TravelFileSchema } from "./travel.js";

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

/** Everything the rule engine reads from a book's plotlint folder: `rules.json`, `frames.json`, `travel.json` and `invariants.json`. */
export async function loadBookRuleData(bookDir: string): Promise<BookRuleData> {
  const [config, frames, travel, invariants] = await Promise.all([
    readPlotlintFile(bookDir, "rules.json", RuleConfigFileSchema),
    readPlotlintFile(bookDir, "frames.json", FramesFileSchema),
    readPlotlintFile(bookDir, "travel.json", TravelFileSchema),
    readPlotlintFile(bookDir, "invariants.json", InvariantsFileSchema),
  ]);
  return {
    ...(config ? { config } : {}), ...(frames ? { frames } : {}), ...(travel ? { travel } : {}), ...(invariants ? { invariants } : {}),
  };
}

/** The overlay a book's verdicts imply (`story/plotlint/verdicts.jsonl`, see adaptive.ts); empty without verdicts. */
export async function loadAdaptiveOverlay(bookDir: string, options: AdaptiveOptions = {}): Promise<RuleConfigFile> {
  return adaptiveOverlay((await loadVerdicts(bookDir)).verdicts, options);
}

/** Validate and write one plotlint JSON file, creating the folder; returns its path. */
export async function writePlotlintFile<S extends z.ZodTypeAny>(bookDir: string, name: string, schema: S, data: z.input<S>): Promise<string> {
  const parsed = schema.parse(data);
  await mkdir(plotlintDir(bookDir), { recursive: true });
  const path = join(plotlintDir(bookDir), name);
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  return path;
}
