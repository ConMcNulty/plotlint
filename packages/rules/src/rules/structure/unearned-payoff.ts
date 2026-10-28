import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../../types.js";
import { hookPromise, hookStart, numberOption, renderHook, structureFinding, summariesTraceHooks, summaryMentions } from "./common.js";

// The other half of setup and payoff: a payoff with no setup before it. A hook
// resolved in the chapter that plants it was never a question the reader carried.
// One resolved `minGap` (default 2) or more chapters after it was planted, with no
// recorded advance in between, may land without having been built up; that case
// needs the book's chapter summaries to name hooks by id, since the ledger keeps
// only a hook's first and last chapters, so it is skipped when they do not, and
// for a hook whose id no summary ever names.
// Both are notes: a quick setup and payoff inside one chapter is sometimes the point.

export const unearnedPayoff: Rule = {
  id: "structure/unearned-payoff",
  layer: "structure",
  hookOverlay: true,
  title: "Payoffs without a setup",
  rationale: "A payoff satisfies when the reader has carried the question for a while. One that is resolved in the same chapter it is raised, or after chapters in which it never comes up, can feel unearned; plant it earlier or keep it alive in between.",
  source: "Robert McKee, Story (1997), ch. 10 \"Setups and Payoffs\"; Blake Snyder, Save the Cat! (2005), on planting and payoff",
  check({ snapshot, options }) {
    const minGap = numberOption(options, "minGap", 2);
    const traced = summariesTraceHooks(snapshot);
    const findings: Diagnostic[] = [];
    for (const hook of snapshot.hooks.hooks) {
      if (hook.status !== "resolved" || hook.startChapter === 0) continue;
      const start = hookStart(hook)!;
      const resolved = hook.lastAdvancedChapter;
      if (resolved === start) {
        findings.push(structureFinding(this, {
          chapter: resolved, severity: "note",
          summary: `"${hookPromise(hook)}" is raised and resolved in the same chapter (ch${resolved}); the payoff may be unearned.`,
          evidence: [renderHook(hook)],
        }));
        continue;
      }
      if (!traced || resolved - start < minGap) continue;
      // Summaries that never name this hook's id (GLM describes numbered hooks
      // like "hook-3" in words) say nothing about whether it was advanced.
      const named = summaryMentions(snapshot, hook);
      if (named.length === 0) continue;
      const between = named.filter((chapter) => chapter > start && chapter < resolved);
      const summarised = snapshot.chapterSummaries.rows.filter((row) => row.chapter > start && row.chapter < resolved).length;
      // Only when every chapter in between has a summary that could have named it.
      if (between.length > 0 || summarised < resolved - start - 1) continue;
      findings.push(structureFinding(this, {
        chapter: resolved, severity: "note",
        summary: `"${hookPromise(hook)}", opened in ch${start}, is resolved in ch${resolved} with no recorded advance in between; the payoff may be unearned.`,
        evidence: [renderHook(hook)],
      }));
    }
    return findings;
  },
};
