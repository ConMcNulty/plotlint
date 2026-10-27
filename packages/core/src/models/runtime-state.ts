import { z } from "zod";

export const RuntimeStateLanguageSchema = z.enum(["zh", "en"]);
export type RuntimeStateLanguage = z.infer<typeof RuntimeStateLanguageSchema>;

export const StateManifestSchema = z.object({
  schemaVersion: z.literal(2),
  language: RuntimeStateLanguageSchema,
  lastAppliedChapter: z.number().int().min(0),
  projectionVersion: z.number().int().min(1),
}).strict();

export type StateManifest = z.infer<typeof StateManifestSchema>;

export const HookStatusSchema = z.enum(["open", "progressing", "deferred", "resolved", "superseded"]);
export type HookStatus = z.infer<typeof HookStatusSchema>;

export const HookRecordSchema = z.object({
  hookId: z.string().min(1),
  startChapter: z.number().int().min(0),
  type: z.string().min(1),
  status: HookStatusSchema,
  lastAdvancedChapter: z.number().int().min(0),
  // A stored hook may have an unspecified payoff. New candidates require one.
  expectedPayoff: z.string(),
  notes: z.string(),
  dependsOn: z.array(z.string().min(1)).optional(),
  paysOffInArc: z.string().optional(),
}).strict();

export type HookRecord = z.infer<typeof HookRecordSchema>;

export const HooksStateSchema = z.object({
  hooks: z.array(HookRecordSchema),
}).strict();

export type HooksState = z.infer<typeof HooksStateSchema>;

export const ChapterSummaryRowSchema = z.object({
  chapter: z.number().int().min(1),
  title: z.string().min(1),
  characters: z.string(),
  events: z.string(),
  stateChanges: z.string(),
  hookActivity: z.string(),
  mood: z.string(),
  chapterType: z.string(),
}).strict();

export type ChapterSummaryRow = z.infer<typeof ChapterSummaryRowSchema>;

export const ChapterSummariesStateSchema = z.object({
  rows: z.array(ChapterSummaryRowSchema),
}).strict();

export type ChapterSummariesState = z.infer<typeof ChapterSummariesStateSchema>;

// plotlint: a typed predicate vocabulary. The settler labels each fact with the
// kind of state it records so rules can match on the kind instead of guessing
// from free-text predicate names ("location", "whereabouts", "位置").
export const FactKindSchema = z.enum([
  "status", // alive, dead, injured, missing, conscious
  "location", // where an entity is
  "possession", // what an entity holds or owns
  "knowledge", // what a character knows or believes
  "relationship", // how two entities stand to each other
  "resource", // a counted quantity: money, ammunition, mana
  "age",
  "identity", // name, alias, role, title, species
  "trait", // a lasting attribute: appearance, skill, personality
  "goal", // what an entity wants or intends
  "world_rule", // a stated law, cost or limit of the setting
  "time", // dates, elapsed time, season
  "other",
]);

export type FactKind = z.infer<typeof FactKindSchema>;

// plotlint: where in a chapter a fact op is established. The settler quotes the
// passage; the host locates the quote in the chapter body it settled (the prose
// without the chapter heading) and records the character offsets. The quote is
// the anchor: later edits move text, so readers re-locate the quote and use the
// offsets only to pick the nearest occurrence. `start`/`end` are absent when the
// quote could not be found.
export const FactEvidenceSchema = z.object({
  quote: z.string().min(1),
  start: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
}).strict();

export type FactEvidence = z.infer<typeof FactEvidenceSchema>;

export const CurrentStateFactSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  validFromChapter: z.number().int().min(0),
  validUntilChapter: z.number().int().min(0).nullable(),
  sourceChapter: z.number().int().min(0),
  kind: FactKindSchema.optional(),
  /** The passage in `sourceChapter` that establishes the fact. */
  evidence: FactEvidenceSchema.optional(),
  /** The passage in chapter `validUntilChapter + 1` that ends the fact. */
  endEvidence: FactEvidenceSchema.optional(),
}).strict();

export type CurrentStateFact = z.infer<typeof CurrentStateFactSchema>;

export const CurrentStateStateSchema = z.object({
  chapter: z.number().int().min(0),
  facts: z.array(CurrentStateFactSchema),
}).strict();

export type CurrentStateState = z.infer<typeof CurrentStateStateSchema>;

export const StateFactInputSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  kind: FactKindSchema.optional(),
  evidence: FactEvidenceSchema.optional(),
}).strict();

export type StateFactInput = z.infer<typeof StateFactInputSchema>;

export const StateFactSelectorSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1).optional(),
  evidence: FactEvidenceSchema.optional(),
}).strict();

export type StateFactSelector = z.infer<typeof StateFactSelectorSchema>;

export const StateFactOpsSchema = z.object({
  upsert: z.array(StateFactInputSchema),
  expire: z.array(StateFactSelectorSchema),
}).strict();

export type StateFactOps = z.infer<typeof StateFactOpsSchema>;

export const HookOpsSchema = z.object({
  upsert: z.array(HookRecordSchema),
  mention: z.array(z.string().min(1)),
  resolve: z.array(z.string().min(1)),
  defer: z.array(z.string().min(1)),
}).strict();

export type HookOps = z.infer<typeof HookOpsSchema>;

export const NewHookCandidateSchema = z.object({
  type: z.string().min(1),
  expectedPayoff: z.string().min(1),
  notes: z.string(),
}).strict();

export type NewHookCandidate = z.infer<typeof NewHookCandidateSchema>;

export const RuntimeStateDeltaSchema = z.object({
  chapter: z.number().int().min(1),
  factOps: StateFactOpsSchema,
  hookOps: HookOpsSchema,
  newHookCandidates: z.array(NewHookCandidateSchema),
  chapterSummary: ChapterSummaryRowSchema.optional(),
}).strict();

export type RuntimeStateDelta = z.infer<typeof RuntimeStateDeltaSchema>;
