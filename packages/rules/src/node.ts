import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { loadVerdicts } from "@plotlint/diagnostics/node";
import { adaptiveOverlay, type AdaptiveOptions } from "./adaptive.js";
import { FramesFileSchema, PacksFileSchema, RuleConfigFileSchema, type BookPlan, type BookRuleData, type RuleConfigFile } from "./book.js";
import { HookOverlayFileSchema } from "./hook-overlay.js";
import { InvariantsFileSchema } from "./invariants.js";
import { SceneAnnotationsFileSchema } from "./scene-annotations.js";
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

/**
 * The length plan in `<bookDir>/book.json` (target chapters, status). InkOS owns
 * that file, so it is read leniently: a missing or unreadable file, or fields of
 * the wrong type, leave the plan out rather than failing the lint.
 */
export async function readBookPlan(bookDir: string): Promise<BookPlan | undefined> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(bookDir, "book.json"), "utf-8"));
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null) return undefined;
  const { targetChapters, status } = json as Record<string, unknown>;
  const plan: BookPlan = {
    ...(typeof targetChapters === "number" && Number.isInteger(targetChapters) && targetChapters > 0 ? { targetChapters } : {}),
    ...(typeof status === "string" ? { status } : {}),
  };
  return Object.keys(plan).length ? plan : undefined;
}

/** Everything the rule engine reads for a book: `rules.json`, `frames.json`, `travel.json`, `invariants.json`, `packs.json`, `scenes.json`, `hooks.json`, and the plan in `book.json`. */
export async function loadBookRuleData(bookDir: string): Promise<BookRuleData> {
  const [config, frames, travel, invariants, packs, plan, scenes, hooks] = await Promise.all([
    readPlotlintFile(bookDir, "rules.json", RuleConfigFileSchema),
    readPlotlintFile(bookDir, "frames.json", FramesFileSchema),
    readPlotlintFile(bookDir, "travel.json", TravelFileSchema),
    readPlotlintFile(bookDir, "invariants.json", InvariantsFileSchema),
    readPlotlintFile(bookDir, "packs.json", PacksFileSchema),
    readBookPlan(bookDir),
    readPlotlintFile(bookDir, "scenes.json", SceneAnnotationsFileSchema),
    readPlotlintFile(bookDir, "hooks.json", HookOverlayFileSchema),
  ]);
  return {
    ...(config ? { config } : {}), ...(frames ? { frames } : {}), ...(travel ? { travel } : {}), ...(invariants ? { invariants } : {}),
    ...(packs ? { packs } : {}), ...(plan ? { plan } : {}),
    ...(scenes ? { scenes } : {}), ...(hooks ? { hooks } : {}),
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
