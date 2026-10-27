import { z } from "zod";
import { DiagnosticSeveritySchema } from "@plotlint/diagnostics";
import type { InvariantsFile } from "./invariants.js";
import type { TravelFile } from "./travel.js";

// Per-book plotlint files beside the story state, in `works/<id>/source/story/plotlint/`.
// They are plain JSON so authors, agents and the editor can all write them.
// `@plotlint/rules/node` reads them; this module only holds the schemas, so it
// stays browser-safe.

const SettingSchema = z.union([
  z.literal("off"),
  DiagnosticSeveritySchema,
  z.object({
    severity: z.union([z.literal("off"), DiagnosticSeveritySchema]).optional(),
    options: z.record(z.unknown()).optional(),
  }).strict(),
]);

/**
 * `rules.json`: turn rules off, change the severity of all their findings, or
 * give them options, keyed by rule id, ESLint style:
 * `{ "version": 1, "rules": { "continuity/dead-then-alive": "note" } }`.
 */
export const RuleConfigFileSchema = z.object({
  version: z.literal(1),
  rules: z.record(SettingSchema).default({}),
}).strict();
export type RuleConfigFile = z.infer<typeof RuleConfigFileSchema>;

/**
 * The narrative frame of a stretch of text. Continuity rules judge the main
 * timeline: facts from a flashback, a dream or a story told inside the story
 * describe another time or no time at all, and an unreliable narrator's account
 * may be wrong on purpose.
 */
export const FrameKindSchema = z.enum(["main", "flashback", "dream", "story", "unreliable"]);
export type FrameKind = z.infer<typeof FrameKindSchema>;

export const FrameEntrySchema = z.object({
  chapter: z.number().int().min(0),
  /** 1-based scene number within the chapter (`ch12.s3` is scene 3); the whole chapter when absent. */
  scene: z.number().int().min(1).optional(),
  frame: FrameKindSchema,
  /** Whose account it is, for an unreliable narrator. */
  pov: z.string().min(1).optional(),
  note: z.string().optional(),
}).strict();
export type FrameEntry = z.infer<typeof FrameEntrySchema>;

/** `frames.json`: which chapters or scenes are not the main timeline. */
export const FramesFileSchema = z.object({
  version: z.literal(1),
  frames: z.array(FrameEntrySchema).default([]),
}).strict();
export type FramesFile = z.infer<typeof FramesFileSchema>;

/** Everything the rule engine reads from a book's plotlint folder. Absent files are absent fields. */
export interface BookRuleData {
  readonly config?: RuleConfigFile;
  readonly frames?: FramesFile;
  /** `invariants.json`: the author's own rules (see invariants.ts); only approved ones run. */
  readonly invariants?: InvariantsFile;
  /** `travel.json`: travel times between places, for continuity/impossible-travel. */
  readonly travel?: TravelFile;
}
