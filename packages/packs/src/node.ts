import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import type { BookRuleData, RuleConfigFile, TextRule } from "@plotlint/rules";
import { plotlintDir } from "@plotlint/rules/node";
import { generalPack, loadPack } from "@plotlint/style/node";
import { effectiveMetricBands, effectiveRuleConfig, resolvePacks, type ResolvedPacks } from "./resolve.js";
import { PackManifestSchema, type LoadedPack, type MetricBands, type PackCatalog } from "./schema.js";

export * from "./index.js";

// src/node.ts and dist/node.js both sit one level below the package root, next to `packs/`.
/** The packs shipped with plotlint: `packages/packs/packs/<name>/`. */
export const builtinPacksDir = fileURLToPath(new URL("../packs/", import.meta.url));

/** A book's own packs, drafted by the writer agent or the author: `story/plotlint/packs/<name>/`. */
export const bookPacksDir = (bookDir: string) => join(plotlintDir(bookDir), "packs");

/** Load one pack folder: `pack.yaml`, `SKILL.md` and its style rules. The folder name must be the pack's name. */
export function loadPackDir(dir: string): LoadedPack {
  const manifestPath = join(dir, "pack.yaml");
  let raw: unknown;
  try {
    raw = load(readFileSync(manifestPath, "utf8").replace(/\r\n/gu, "\n"));
  } catch (error) {
    throw new Error(`Cannot read ${manifestPath}: ${(error as Error).message}`);
  }
  const parsed = PackManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid ${manifestPath}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "pack"}: ${issue.message}`).join("; ")}`);
  }
  const manifest = parsed.data;
  const folder = dir.replace(/[\\/]+$/u, "").split(/[\\/]/u).pop();
  if (folder !== manifest.name) throw new Error(`${manifestPath} names pack "${manifest.name}" but sits in folder "${folder}"`);
  const skillPath = join(dir, "SKILL.md");
  const skill = existsSync(skillPath) ? readFileSync(skillPath, "utf8").replace(/\r\n/gu, "\n") : undefined;
  let styleRules: TextRule[] = [];
  if (manifest.styles === "builtin:general") styleRules = generalPack();
  else if (manifest.styles?.startsWith("builtin:")) throw new Error(`${manifestPath}: unknown built-in style ${manifest.styles}`);
  else if (manifest.styles) styleRules = loadPack(join(dir, manifest.styles), manifest.name);
  return { manifest, ...(skill === undefined ? {} : { skill }), styleRules, dir };
}

/** Every pack folder (one with a `pack.yaml`) under `root`, by name. */
export function loadPackFolder(root: string): Map<string, LoadedPack> {
  const packs = new Map<string, LoadedPack>();
  if (!existsSync(root)) return packs;
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && existsSync(join(root, entry.name, "pack.yaml"))) {
      const pack = loadPackDir(join(root, entry.name));
      packs.set(pack.manifest.name, pack);
    }
  }
  return packs;
}

let builtin: Map<string, LoadedPack> | undefined;

/** The shipped packs, read once per process. */
export function builtinPacks(): PackCatalog {
  builtin ??= loadPackFolder(builtinPacksDir);
  return builtin;
}

/** The shipped packs plus a book's own (`story/plotlint/packs/`), which may not reuse a shipped name. */
export function bookPackCatalog(bookDir: string): PackCatalog {
  const own = loadPackFolder(bookPacksDir(bookDir));
  if (own.size === 0) return builtinPacks();
  const catalog = new Map(builtinPacks());
  for (const [name, pack] of own) {
    if (catalog.has(name)) throw new Error(`${pack.dir}: a book pack cannot replace the built-in pack "${name}"`);
    catalog.set(name, pack);
  }
  return catalog;
}

export interface BookPacks {
  readonly resolved: ResolvedPacks;
  /** packs.json names no pack has: skipped so the lint still runs. */
  readonly missing: string[];
  /** Packs < overlays < the book's rules.json. */
  readonly config: RuleConfigFile;
  readonly metrics: MetricBands;
  /** The style rules of `general` and the selected packs. */
  readonly styleRules: TextRule[];
}

/**
 * Resolve a book's packs (`packs.json`, else general only) into what the lint runs:
 * the effective rule config (packs, then `overlays`, then the book's `rules.json`),
 * metric bands and style rules. `knownRuleIds` expand the packs' globs.
 */
export function resolveBookPacks(
  bookDir: string,
  book: BookRuleData,
  knownRuleIds: ReadonlyArray<string>,
  overlays: ReadonlyArray<RuleConfigFile | undefined> = [],
): BookPacks {
  const catalog = bookPackCatalog(bookDir);
  const wanted = book.packs?.packs ?? [];
  const missing = wanted.filter((name) => !catalog.has(name));
  const resolved = resolvePacks(wanted.filter((name) => catalog.has(name)), catalog, { knownRuleIds });
  return {
    resolved,
    missing,
    config: effectiveRuleConfig(resolved, ...overlays, book.config),
    metrics: effectiveMetricBands(resolved, ...overlays, book.config),
    styleRules: resolved.styleRules,
  };
}
