import { GENERAL_PACK, type LoadedPack, type PackCatalog } from "./schema.js";

export interface PackProblem {
  /** `error` breaks the pack; `warn` is a rule id the host does not know (yet), which packs may name. */
  readonly level: "error" | "warn";
  readonly pack: string;
  readonly message: string;
}

const globRegex = (glob: string) =>
  new RegExp(`^${glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join("[^/]*")}$`, "u");

/**
 * Check one pack against the catalog and the host's rule ids. Packs may name
 * rules that do not exist yet (structure and metric checks land over phase 4),
 * so those are warnings; a missing parent, a self-extend or a missing SKILL.md are errors.
 */
export function validatePack(pack: LoadedPack, catalog: PackCatalog, knownRuleIds: ReadonlyArray<string>): PackProblem[] {
  const { manifest } = pack;
  const name = manifest.name;
  const problems: PackProblem[] = [];
  const known = new Set([...knownRuleIds, ...pack.styleRules.map((rule) => rule.id)]);
  for (const parent of manifest.extends ?? []) {
    if (parent === name) problems.push({ level: "error", pack: name, message: "extends itself" });
    else if (!catalog.has(parent)) problems.push({ level: "error", pack: name, message: `extends unknown pack "${parent}"` });
    if (parent === GENERAL_PACK) problems.push({ level: "warn", pack: name, message: "extends general, which every pack extends already" });
  }
  if (name === GENERAL_PACK && manifest.extends?.length) problems.push({ level: "error", pack: name, message: "general cannot extend other packs" });
  if (!pack.skill?.trim()) problems.push({ level: "error", pack: name, message: "has no SKILL.md" });
  const keys = [...Object.keys(manifest.checks ?? {}), ...Object.keys(manifest.metrics ?? {}).map((id) => id)];
  for (const key of keys) {
    if (key.includes("*")) {
      const regex = globRegex(key);
      if (![...known].some((id) => regex.test(id))) problems.push({ level: "warn", pack: name, message: `glob ${key} matches no known rule` });
    } else if (!known.has(key)) {
      problems.push({ level: "warn", pack: name, message: `${key} is not a known rule (yet)` });
    }
  }
  for (const id of Object.keys(manifest.metrics ?? {})) {
    if (!id.startsWith("metrics/")) problems.push({ level: "warn", pack: name, message: `band for ${id}, which is not a metrics/ rule` });
  }
  return problems;
}
