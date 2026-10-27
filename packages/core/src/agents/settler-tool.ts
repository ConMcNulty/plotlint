import { Type } from "@sinclair/typebox";

const HookRecordToolSchema = Type.Object({
  hookId: Type.String(),
  startChapter: Type.Integer({ minimum: 0 }),
  type: Type.String(),
  status: Type.Union([
    Type.Literal("open"),
    Type.Literal("progressing"),
    Type.Literal("deferred"),
    Type.Literal("resolved"),
    Type.Literal("superseded"),
  ]),
  lastAdvancedChapter: Type.Integer({ minimum: 0 }),
  expectedPayoff: Type.String(),
  notes: Type.String(),
  dependsOn: Type.Optional(Type.Array(Type.String())),
  paysOffInArc: Type.Optional(Type.String()),
});

const ChapterSummaryToolSchema = Type.Object({
  title: Type.String(),
  characters: Type.String(),
  events: Type.String(),
  stateChanges: Type.String(),
  hookActivity: Type.String(),
  mood: Type.String(),
  chapterType: Type.String(),
});

// plotlint: every fact op cites the passage that establishes it, and upserts
// carry a typed kind. The host locates each quote in the chapter text.
const FactEvidenceToolSchema = Type.String({
  minLength: 1,
  description: "Exact verbatim passage from this chapter's body that establishes this change: one sentence or clause, copied character for character, at most about 200 characters.",
});

const FactKindToolSchema = Type.Union([
  Type.Literal("status"),
  Type.Literal("location"),
  Type.Literal("possession"),
  Type.Literal("knowledge"),
  Type.Literal("relationship"),
  Type.Literal("resource"),
  Type.Literal("age"),
  Type.Literal("identity"),
  Type.Literal("trait"),
  Type.Literal("goal"),
  Type.Literal("world_rule"),
  Type.Literal("time"),
  Type.Literal("other"),
], {
  description: "What the fact records: status (alive, dead, injured, missing), location, possession (holds or owns), knowledge (knows or believes), relationship, resource (a counted amount), age, identity (name, alias, role), trait, goal, world_rule (a law or cost of the setting), time, or other.",
});

const StateFactToolSchema = Type.Object({
  subject: Type.String({ minLength: 1, description: "Stable entity or scope the fact describes." }),
  predicate: Type.String({ minLength: 1, description: "Natural-language relation or state name." }),
  object: Type.String({ minLength: 1, description: "Value explicitly established by the chapter." }),
  kind: Type.Optional(FactKindToolSchema),
  // Required by the prompt and checked by the host, which asks once for missing
  // quotes; optional in the schema so one uncited op cannot fail a settlement.
  evidence: Type.Optional(FactEvidenceToolSchema),
});

const StateFactSelectorToolSchema = Type.Object({
  subject: Type.String({ minLength: 1 }),
  predicate: Type.String({ minLength: 1 }),
  object: Type.Optional(Type.String({ minLength: 1 })),
  evidence: Type.Optional(FactEvidenceToolSchema),
});

export const SettlementToolSchema = Type.Object({
  postSettlement: Type.String({ description: "Concise account of the state changes grounded in this chapter." }),
  factOps: Type.Object({
    upsert: Type.Array(StateFactToolSchema, { description: "Facts made current by this chapter." }),
    expire: Type.Array(StateFactSelectorToolSchema, { description: "Previously active facts explicitly ended or superseded by this chapter." }),
  }),
  hookOps: Type.Object({
    upsert: Type.Array(HookRecordToolSchema, {
      description: "Full updates for existing hook ids. Use superseded only when current author-approved foundation or revision explicitly withdraws the premise; cite that authority in notes and preserve the original hook content. Absence from a chapter is not withdrawal. Never invent an id here or withdraw a resolved hook.",
    }),
    mention: Type.Array(Type.String(), { description: "Exact existing hook ids mentioned without changing status." }),
    resolve: Type.Array(Type.String(), { description: "Exact existing hook ids resolved by this chapter." }),
    defer: Type.Array(Type.String(), { description: "Exact existing hook ids explicitly deferred by this chapter." }),
  }),
  newHookCandidates: Type.Array(Type.Object({
    type: Type.String({ minLength: 1 }),
    expectedPayoff: Type.String({ minLength: 1 }),
    notes: Type.String(),
  }), { description: "Brand-new unresolved promises. Do not assign a hook id; the host assigns the canonical id." }),
  chapterSummary: ChapterSummaryToolSchema,
});

export function createSettlementToolSchema(allowNewHooks = true) {
  return Type.Object({
    ...SettlementToolSchema.properties,
    newHookCandidates: Type.Array(SettlementToolSchema.properties.newHookCandidates.items, {
      description: allowNewHooks ? "New unresolved promises without assigned ids." : "This recovery preserves existing hook ids. Submit an empty array; new hooks are not permitted.",
      ...(allowNewHooks ? {} : { maxItems: 0 }),
    }),
  });
}
