export type { Rule, RuleContext } from "./types.js";
export { builtinRules, checkDelta, checkSnapshot } from "./engine.js";
export { deadEntityActs } from "./rules/dead-entity-acts.js";
export type { TextDocument, TextFindingInput, TextRule, TextRuleContext } from "./text.js";
export { checkText, textDiagnostic } from "./text.js";
