import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TextRule } from "@plotlint/rules";
import { loadStyleRules } from "./vale.js";

export * from "./index.js";

/** Load every `.yml`/`.yaml` rule in a Vale style folder; the folder name is the style name. */
export function loadPack(dir: string, styleName = basename(dir)): TextRule[] {
  const files = readdirSync(dir).filter((file) => /\.ya?ml$/i.test(file)).sort();
  return loadStyleRules(Object.fromEntries(files.map((file) => [`${styleName}/${file}`, readFileSync(join(dir, file), "utf8")])));
}

// src/node.ts and dist/node.js both sit one level below the package root, next to `packs/`.
const packsDir = fileURLToPath(new URL("../packs/", import.meta.url));

/** The always-on general pack (`style/general.*`), read from the package's `packs/general`. */
export function generalPack(): TextRule[] {
  return loadPack(join(packsDir, "general"));
}
