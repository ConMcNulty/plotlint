import type { Rule } from "../../types.js";
import { fairPlay } from "./fair-play.js";
import { inventedTermSpelling } from "./invented-term-spelling.js";
import { bothLeadsPov, centralRelationship, hopefulEnding } from "./romance.js";

// Genre-specific rules. They run like any state rule, but the general pack turns
// them off; the mystery, romance and fantasy packs turn them on.

export const genreRules: ReadonlyArray<Rule> = [fairPlay, hopefulEnding, centralRelationship, bothLeadsPov, inventedTermSpelling];

export { bothLeadsPov, centralRelationship, fairPlay, hopefulEnding, inventedTermSpelling };
export type { MysterySolution } from "./fair-play.js";
export { isRevealFact, mysterySolution } from "./fair-play.js";
export { editDistance, nearSpelling } from "./invented-term-spelling.js";
export { coupleFact, relationshipChapters, relationshipTone, romanceLeads } from "./romance.js";
