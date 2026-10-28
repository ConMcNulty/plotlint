import type { DiagnosticSeverity } from "@plotlint/diagnostics";
import type { RuleConfigFile, RuleSetting, TextRule } from "@plotlint/rules";
import { GENERAL_PACK, type LoadedPack, type MetricBand, type MetricBands, type PackCatalog, type PackReaderPersona } from "./schema.js";

/*
 * Stacking check packs. A book runs `general` plus the genre packs it selected.
 *
 * - Along an `extends` chain a pack overrides what it builds on, and every chain
 *   starts at `general`, so a genre pack can loosen a general check (literary
 *   turns scene-turn down to a note) as well as tighten one.
 * - Between the selected packs (romantasy = romance + fantasy) the stricter
 *   setting wins: on beats off, error > warning > note; options are merged with
 *   the later pack winning; for metric bands the narrower wins (larger min, smaller max).
 * - On top of that, overlays (an adaptive overlay from the writer's verdicts) and
 *   last the book's own rules.json override everything: the author always wins.
 *
 * Globs (`structure/*`, `style/fantasy.*`) expand against the known rule ids:
 * the caller's list plus the packs' own style rules. Within one pack an exact id
 * beats a glob, and a longer glob beats a shorter one.
 */

type Level = DiagnosticSeverity | "off";

/** A setting in one shape: no `severity` means the rule runs at its own default. */
interface Setting {
  readonly severity?: Level;
  readonly options?: Readonly<Record<string, unknown>>;
}

const normalize = (setting: RuleSetting): Setting => (typeof setting === "string" ? { severity: setting } : setting);

function denormalize(setting: Setting): RuleSetting {
  const options = setting.options && Object.keys(setting.options).length ? setting.options : undefined;
  if (!options) return setting.severity ?? {};
  return { ...(setting.severity ? { severity: setting.severity } : {}), options: { ...options } };
}

/** `top` overrides `base`: a severity replaces the base one, options merge with `top` winning. */
function override(base: Setting | undefined, top: Setting): Setting {
  const severity = top.severity ?? base?.severity;
  const options = base?.options || top.options ? { ...base?.options, ...top.options } : undefined;
  return { ...(severity ? { severity } : {}), ...(options ? { options } : {}) };
}

// A rule on at its own default sits between note (explicitly loosened) and warning.
const rank = (level: Level | undefined) =>
  level === undefined ? 1.5 : ({ off: 0, note: 1, warning: 2, error: 3 } as const)[level];

/** Stacked packs: the stricter severity wins (a tie goes to the later pack), options merge with the later pack winning. */
function stricter(a: Setting, b: Setting): { setting: Setting; winner: "a" | "b" } {
  const winner = rank(b.severity) >= rank(a.severity) ? "b" : "a";
  const severity = winner === "b" ? b.severity : a.severity;
  const options = a.options || b.options ? { ...a.options, ...b.options } : undefined;
  return { setting: { ...(severity ? { severity } : {}), ...(options ? { options } : {}) }, winner };
}

function narrower(a: MetricBand, b: MetricBand): MetricBand {
  const band: MetricBand = { ...a, ...b };
  const min = [a.min, b.min].filter((value): value is number => value !== undefined);
  const max = [a.max, b.max].filter((value): value is number => value !== undefined);
  if (min.length) band.min = Math.max(...min);
  if (max.length) band.max = Math.min(...max);
  return band;
}

const isGlob = (key: string) => key.includes("*");

function globRegex(glob: string): RegExp {
  const escaped = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join("[^/]*");
  return new RegExp(`^${escaped}$`, "u");
}

/** Expand a settings map's globs against `known`: globs first, shortest first, then exact ids. Returns globs that matched nothing too. */
function expand<T>(entries: Readonly<Record<string, T>>, known: ReadonlyArray<string>): { values: Array<[string, T]>; unmatched: string[] } {
  const keys = Object.keys(entries);
  const globs = keys.filter(isGlob).sort((a, b) => a.replace(/\*/gu, "").length - b.replace(/\*/gu, "").length);
  const values: Array<[string, T]> = [];
  const unmatched: string[] = [];
  for (const glob of globs) {
    const regex = globRegex(glob);
    const matched = known.filter((id) => regex.test(id));
    if (matched.length === 0) unmatched.push(glob);
    for (const id of matched) values.push([id, entries[glob]!]);
  }
  for (const key of keys) if (!isGlob(key)) values.push([key, entries[key]!]);
  return { values, unmatched };
}

export class PackResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackResolutionError";
  }
}

export interface ResolvedPacks {
  /** Every pack that took part, in load order: `general`, then each selected pack's chain. */
  readonly packs: string[];
  /** The genre packs asked for, without `general`, deduplicated. */
  readonly selected: string[];
  /** The packs' rule settings, globs expanded. */
  readonly config: RuleConfigFile;
  /** Metric bands by rule id, for `createMetricRules`. */
  readonly metrics: MetricBands;
  /** Style rules of every pack, `general` first, deduplicated by id. */
  readonly styleRules: TextRule[];
  /** Which pack set each rule's setting or band (several when stacked packs both contributed). */
  readonly provenance: Record<string, string[]>;
  /** The ids globs were expanded against (the caller's plus the packs' style rules). */
  readonly knownRuleIds: string[];
  /** Globs in the packs that matched no known rule. */
  readonly unmatchedGlobs: string[];
  /** Closed-loop settings of the stacked packs (see `stackLoop`). */
  readonly loop: ResolvedLoop;
}

export interface ResolvedLoop {
  /** Priority globs: the selected genre packs' first, then what they build on, `general` last. */
  readonly priority: string[];
  /** The smallest warning threshold any pack sets, or undefined. */
  readonly warnings?: number;
  /** The reader panel of the most specific pack that names one; stacked genre packs pool theirs. */
  readonly readers: PackReaderPersona[];
  readonly heldOut: string[];
}

interface Flat {
  settings: Map<string, { setting: Setting; from: string[] }>;
  bands: Map<string, { band: MetricBand; from: string[] }>;
}

export interface ResolveOptions {
  /** Rule ids the host knows (state, text, metric and structure rules), for glob expansion. */
  readonly knownRuleIds?: ReadonlyArray<string>;
}

/**
 * Resolve a book's pack selection into one rule config, metric bands and style rules.
 * `general` always comes first; unknown packs and `extends` cycles are errors.
 */
export function resolvePacks(names: ReadonlyArray<string>, catalog: PackCatalog, options: ResolveOptions = {}): ResolvedPacks {
  const get = (name: string, path: ReadonlyArray<string>): LoadedPack => {
    const pack = catalog.get(name);
    if (pack) return pack;
    const via = path.length ? ` (extended by ${path[path.length - 1]})` : "";
    throw new PackResolutionError(`unknown pack "${name}"${via}; available: ${[...catalog.keys()].sort().join(", ") || "(none)"}`);
  };

  /** The pack and what it builds on, ancestors first, `general` at the root. */
  const chain = (name: string, path: string[] = []): string[] => {
    if (path.includes(name)) throw new PackResolutionError(`pack extends cycle: ${[...path, name].join(" -> ")}`);
    const pack = get(name, path);
    const parents = name === GENERAL_PACK ? [] : [GENERAL_PACK, ...(pack.manifest.extends ?? [])];
    const order: string[] = [];
    for (const parent of parents) for (const ancestor of chain(parent, [...path, name])) if (!order.includes(ancestor)) order.push(ancestor);
    order.push(name);
    return order;
  };

  const selected = [...new Set(names.filter((name) => name !== GENERAL_PACK))];
  const chains = selected.length ? selected.map((name) => chain(name)) : [chain(GENERAL_PACK)];
  const packs = [...new Set(chains.flat())];

  const styleRules: TextRule[] = [];
  const styleIds = new Set<string>();
  for (const name of packs) {
    for (const rule of get(name, []).styleRules) {
      if (!styleIds.has(rule.id)) {
        styleIds.add(rule.id);
        styleRules.push(rule);
      }
    }
  }
  const knownRuleIds = [...new Set([...(options.knownRuleIds ?? []), ...styleIds])];
  const unmatchedGlobs = new Set<string>();

  const flatten = (order: ReadonlyArray<string>): Flat => {
    const flat: Flat = { settings: new Map(), bands: new Map() };
    for (const name of order) {
      const { manifest } = get(name, []);
      const checks = expand(manifest.checks ?? {}, knownRuleIds);
      checks.unmatched.forEach((glob) => unmatchedGlobs.add(glob));
      for (const [id, setting] of checks.values) {
        flat.settings.set(id, { setting: override(flat.settings.get(id)?.setting, normalize(setting as RuleSetting)), from: [name] });
      }
      const metrics = expand(manifest.metrics ?? {}, knownRuleIds);
      metrics.unmatched.forEach((glob) => unmatchedGlobs.add(glob));
      for (const [id, band] of metrics.values) {
        flat.bands.set(id, { band: { ...flat.bands.get(id)?.band, ...(band as MetricBand) }, from: [name] });
      }
    }
    return flat;
  };

  const stacked: Flat = { settings: new Map(), bands: new Map() };
  for (const flat of chains.map(flatten)) {
    for (const [id, entry] of flat.settings) {
      const current = stacked.settings.get(id);
      if (!current) {
        stacked.settings.set(id, entry);
        continue;
      }
      const { setting, winner } = stricter(current.setting, entry.setting);
      // The pack whose severity won, then the other one only if its options survive.
      const [won, lost] = winner === "b" ? [entry, current] : [current, entry];
      const from = [...won.from, ...(lost.setting.options && Object.keys(lost.setting.options).length ? lost.from : [])];
      stacked.settings.set(id, { setting, from: [...new Set(from)] });
    }
    for (const [id, entry] of flat.bands) {
      const current = stacked.bands.get(id);
      stacked.bands.set(id, current
        ? { band: narrower(current.band, entry.band), from: [...new Set([...current.from, ...entry.from])] }
        : entry);
    }
  }

  // Loop settings. Along a chain the more specific pack comes first; between stacked packs, all of them count;
  // `general`, at the root of every chain, comes last.
  const priority: string[] = [];
  const heldOut = new Set<string>();
  let warnings: number | undefined;
  const readers: PackReaderPersona[] = [];
  const takeLoop = (name: string) => {
    const loop = get(name, []).manifest.loop;
    for (const glob of loop?.priority ?? []) if (!priority.includes(glob)) priority.push(glob);
    for (const glob of loop?.heldOut ?? []) heldOut.add(glob);
    if (loop?.warnings !== undefined) warnings = Math.min(warnings ?? Infinity, loop.warnings);
    return loop?.readers;
  };
  for (const order of chains) {
    let panel: PackReaderPersona[] | undefined;
    for (const name of [...order].reverse()) {
      if (name === GENERAL_PACK) continue;
      const named = takeLoop(name);
      panel ??= named;
    }
    for (const reader of panel ?? []) if (!readers.some((other) => other.name === reader.name)) readers.push(reader);
  }
  const generalPanel = takeLoop(GENERAL_PACK);
  if (readers.length === 0) readers.push(...(generalPanel ?? []));

  const provenance: Record<string, string[]> = {};
  for (const [id, { from }] of stacked.settings) provenance[id] = [...from];
  for (const [id, { from }] of stacked.bands) provenance[id] = [...new Set([...(provenance[id] ?? []), ...from])];

  return {
    packs,
    selected,
    config: { version: 1, rules: Object.fromEntries([...stacked.settings].map(([id, { setting }]) => [id, denormalize(setting)])) },
    metrics: Object.fromEntries([...stacked.bands].map(([id, { band }]) => [id, band])),
    styleRules,
    provenance,
    knownRuleIds,
    unmatchedGlobs: [...unmatchedGlobs],
    loop: { priority, ...(warnings === undefined ? {} : { warnings }), readers, heldOut: [...heldOut] },
  };
}

/**
 * The rule config a book runs with: the packs' settings, then each overlay in
 * order (an adaptive overlay from the writer's verdicts, say), then — pass it
 * last — the book's own `rules.json`. Later layers override earlier ones: a bare
 * severity keeps the earlier options, given options merge over them.
 */
export function effectiveRuleConfig(resolved: ResolvedPacks, ...overlays: ReadonlyArray<RuleConfigFile | undefined>): RuleConfigFile {
  const rules = new Map<string, Setting>(Object.entries(resolved.config.rules).map(([id, setting]) => [id, normalize(setting as RuleSetting)]));
  for (const overlay of overlays) {
    if (!overlay) continue;
    for (const [id, setting] of expand(overlay.rules, resolved.knownRuleIds).values) {
      rules.set(id, override(rules.get(id), normalize(setting as RuleSetting)));
    }
  }
  return { version: 1, rules: Object.fromEntries([...rules].map(([id, setting]) => [id, denormalize(setting)])) };
}

/**
 * The metric bands after overlays: an overlay's `options.min` / `options.max` for
 * a metric rule replace the pack band's (the author widening a band), and other
 * options are merged in. Turning a metric off is left to the rule config.
 */
export function effectiveMetricBands(resolved: ResolvedPacks, ...overlays: ReadonlyArray<RuleConfigFile | undefined>): MetricBands {
  const bands: MetricBands = Object.fromEntries(Object.entries(resolved.metrics).map(([id, band]) => [id, { ...band }]));
  for (const overlay of overlays) {
    if (!overlay) continue;
    for (const [id, setting] of expand(overlay.rules, resolved.knownRuleIds).values) {
      const options = typeof setting === "object" ? (setting as Setting).options : undefined;
      if (!options || !(id in bands || id.startsWith("metrics/"))) continue;
      bands[id] = { ...bands[id], ...options } as MetricBand;
    }
  }
  return bands;
}
