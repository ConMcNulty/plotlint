import { z } from "zod";
import { RuleSettingSchema, type TextRule } from "@plotlint/rules";

// The machine-readable half of a check pack: `packs/<name>/pack.yaml`. The other
// half is `SKILL.md`, which says what the pack is for and which craft tradition
// each opinionated check comes from, so the writer can disagree with it.

export const PackNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/u, "pack names are lowercase kebab-case");

/** A rule id (`continuity/knowledge-leak`, `style/general.Cliches`) or a glob over ids (`structure/*`, `style/fantasy.*`). */
export const RuleKeySchema = z.string().regex(/^[a-z*]+\/[A-Za-z0-9.*_-]+$/u, "keys are rule ids like layer/name, or globs with *");

/** Floors and bands, never targets: a metric rule only flags text outside `[min, max]`. Other keys are the metric's own options. */
export const MetricBandSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
}).passthrough().refine((band) => band.min === undefined || band.max === undefined || band.min <= band.max, {
  message: "min must not be above max",
});
export type MetricBand = { min?: number; max?: number; [key: string]: unknown };
/** Bands by metric rule id, the shape `createMetricRules` in `@plotlint/metrics` takes. */
export type MetricBands = Record<string, MetricBand>;

/** A beta-reader persona for the closed loop's reader panel. */
export const ReaderPersonaSchema = z.object({
  name: PackNameSchema,
  brief: z.string().min(1),
}).strict();
export type PackReaderPersona = z.infer<typeof ReaderPersonaSchema>;

/** How the closed loop (`@plotlint/loop`) treats this genre. */
export const PackLoopSchema = z.object({
  /** Rule ids or globs, highest first: ranks findings and settles editors' conflicting notes. */
  priority: z.array(RuleKeySchema).optional(),
  /** Open warnings allowed when the loop stops clean. */
  warnings: z.number().int().min(0).optional(),
  /** The beta-reader panel; replaces the panel of the packs this one builds on. */
  readers: z.array(ReaderPersonaSchema).min(1).optional(),
  /** Extra checks the author agent never sees, on top of the loop's defaults. */
  heldOut: z.array(RuleKeySchema).optional(),
}).strict();
export type PackLoop = z.infer<typeof PackLoopSchema>;

export const PackManifestSchema = z.object({
  name: PackNameSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  /** Packs this one builds on; it overrides what they set. Every pack implicitly extends `general`. */
  extends: z.array(PackNameSchema).optional(),
  /** Rule settings, as in `rules.json`, keyed by rule id or glob. */
  checks: z.record(RuleKeySchema, RuleSettingSchema).optional(),
  /** Metric bands by metric rule id. */
  metrics: z.record(RuleKeySchema, MetricBandSchema).optional(),
  /**
   * Folder of Vale-subset style rules, relative to the pack folder; their ids are
   * `style/<pack>.<Rule>`. `builtin:general` is `@plotlint/style`'s general pack (`style/general.*`).
   */
  styles: z.string().min(1).optional(),
  /** How the pack is proposed for a book without an LLM: words in InkOS's genre field. */
  selection: z.object({ keywords: z.array(z.string().min(1)).optional() }).strict().optional(),
  /** Closed-loop settings: priority, warning threshold, reader panel, held-out checks. */
  loop: PackLoopSchema.optional(),
}).strict();
export type PackManifest = z.infer<typeof PackManifestSchema>;

/** A pack ready to resolve: its manifest, its skill doc and its loaded style rules. */
export interface LoadedPack {
  readonly manifest: PackManifest;
  /** The SKILL.md text. */
  readonly skill?: string;
  readonly styleRules: ReadonlyArray<TextRule>;
  /** Where it was loaded from, for messages. */
  readonly dir?: string;
}

/** Packs by name. */
export type PackCatalog = ReadonlyMap<string, LoadedPack>;

/** The pack every book runs. */
export const GENERAL_PACK = "general";
