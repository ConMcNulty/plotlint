import type { Rule } from "../../types.js";
import { cutCandidate } from "./cut-candidate.js";
import { openQuestions } from "./open-questions.js";
import { subplotBalance } from "./subplot-balance.js";
import { unearnedPayoff } from "./unearned-payoff.js";
import { unpaidSetup } from "./unpaid-setup.js";

// L4 structural rules that need only InkOS story state (hooks, summaries, facts)
// and, optionally, chapter text. Rules that need scene annotations live elsewhere.

export const structureRules: ReadonlyArray<Rule> = [unpaidSetup, unearnedPayoff, cutCandidate, openQuestions, subplotBalance];

export { cutCandidate, openQuestions, subplotBalance, unearnedPayoff, unpaidSetup };
export type { DependencyEdge, DependencyGraph, DependencyGraphOptions, DependencyNode } from "./dependency-graph.js";
export { dependencyGraph } from "./dependency-graph.js";
export { openCounts, openSpan } from "./open-questions.js";
export type { Subplot } from "./subplot-balance.js";
export { subplots } from "./subplot-balance.js";
