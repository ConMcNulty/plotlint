export type { Rule, RuleContext, RuleSetting } from "./types.js";
export type { CheckOptions } from "./engine.js";
export { builtinRegistry, builtinRules, checkDelta, checkSnapshot } from "./engine.js";
export type { ConfiguredRule } from "./registry.js";
export { RuleRegistry } from "./registry.js";
export type { BookRuleData, FrameEntry, FrameKind, FramesFile, RuleConfigFile } from "./book.js";
export { FrameEntrySchema, FrameKindSchema, FramesFileSchema, RuleConfigFileSchema } from "./book.js";
export type { FrameResolver } from "./frames.js";
export { downgradeUnreliable, frameMarkers, frameResolver, mainTimeline, OFF_TIMELINE } from "./frames.js";
export { deadEntityActs } from "./rules/dead-entity-acts.js";
export { deadThenAlive } from "./rules/dead-then-alive.js";
export { itemTwoHolders } from "./rules/item-two-holders.js";
export { knowledgeLeak } from "./rules/knowledge-leak.js";
export { negativeResource } from "./rules/negative-resource.js";
export { singleValuedConflict } from "./rules/single-valued-conflict.js";
export { twoPlacesAtOnce } from "./rules/two-places-at-once.js";
export type { TextDocument, TextFindingInput, TextRule, TextRuleContext } from "./text.js";
export { checkText, textDiagnostic } from "./text.js";
export type { Scene, SceneBreak, SceneBreakKind, SegmentScenesOptions } from "./scenes.js";
export { diagnosticScene, sceneAt, scenesOverlapping, segmentScenes } from "./scenes.js";
export { classifyPredicate, factKind, hasKind } from "./predicates.js";
export type {
  ChapterTexts, CursorPosition, Definition, EntityAtCursor, EvidenceCoverage, EvidenceIssue, EvidenceLocation, EvidenceStatus, FactAtCursor,
} from "./evidence.js";
export { endedAt, establishedAt, evidenceCoverage, findDefinitions, locateEvidence, stateAt } from "./evidence.js";
