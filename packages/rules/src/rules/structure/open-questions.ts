import type { HookRecord, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../../types.js";
import { bookEnd, chapterSpan, hookPromise, hookStart, numberOption, renderHook, structureFinding } from "./common.js";

// Open questions per chapter, from the hook ledger. A hook is open in a chapter
// from the one that plants it until the one before it is resolved (or until its
// last advance, when it was superseded); deferred hooks stay open. Two shapes are
// flagged: a run of `flatRun` (default 3) or more chapters with fewer than
// `minOpen` (default 1) open questions, where the reader has nothing to wonder
// about; and a chapter that opens more than `maxNew` (default 6) at once, which
// can confuse more than intrigue. Hooks seeded from the outline that no chapter
// advanced are not on the page and do not count. A book with no hooks on the
// page is skipped: its ledger is not being kept.

/** The chapters a hook is open in, as [from, to] inclusive, or null when it is never open on the page. */
export function openSpan(hook: HookRecord, end: number): readonly [number, number] | null {
  const start = hookStart(hook);
  if (start === null) return null;
  if (hook.status === "resolved") return [start, Math.max(start, hook.lastAdvancedChapter - 1)];
  if (hook.status === "superseded") return [start, Math.max(start, hook.lastAdvancedChapter)];
  return [start, end];
}

/** How many questions are open in each chapter 1..end. */
export function openCounts(snapshot: RuntimeStateSnapshot, end: number): number[] {
  const counts = Array.from({ length: end + 1 }, () => 0);
  for (const hook of snapshot.hooks.hooks) {
    const span = openSpan(hook, end);
    if (!span) continue;
    for (let chapter = span[0]; chapter <= Math.min(span[1], end); chapter++) counts[chapter]! += 1;
  }
  return counts;
}

export const openQuestions: Rule = {
  id: "structure/open-questions",
  layer: "structure",
  hookOverlay: true,
  title: "Too few or too many open questions",
  rationale: "Readers turn pages to find out. Chapters with no open question give them no reason to; a chapter that raises a crowd of questions at once can confuse rather than intrigue. Keep at least one question alive and raise new ones a few at a time.",
  source: "Lee Child, \"A Simple Way to Create Suspense\", New York Times (2012); Robert McKee, Story (1997), on curiosity and concern",
  check({ snapshot, chapters, options }) {
    const end = bookEnd(snapshot, chapters);
    const onPage = snapshot.hooks.hooks.filter((hook) => hookStart(hook) !== null);
    if (onPage.length === 0 || end < 1) return [];
    const minOpen = numberOption(options, "minOpen", 1);
    const flatRun = Math.max(1, numberOption(options, "flatRun", 3));
    const maxNew = numberOption(options, "maxNew", 6);
    const counts = openCounts(snapshot, end);
    const findings: Diagnostic[] = [];

    let runStart: number | null = null;
    for (let chapter = 1; chapter <= end + 1; chapter++) {
      const flat = chapter <= end && counts[chapter]! < minOpen;
      if (flat && runStart === null) runStart = chapter;
      if (!flat && runStart !== null) {
        const runEnd = chapter - 1;
        if (runEnd - runStart + 1 >= flatRun) {
          const last = onPage.filter((hook) => (openSpan(hook, end)?.[1] ?? 0) < runStart!).sort((a, b) => b.lastAdvancedChapter - a.lastAdvancedChapter)[0];
          findings.push(structureFinding(this, {
            chapter: runStart, severity: "note",
            summary: `${chapterSpan(runStart, runEnd)} ${runEnd > runStart ? "have" : "has"} ${minOpen <= 1 ? "no open question" : `fewer than ${minOpen} open questions`}.`,
            evidence: [
              `open questions per chapter: ${counts.slice(runStart, runEnd + 1).map((n, i) => `ch${runStart! + i}=${n}`).join(", ")}`,
              ...(last ? [`last question before the run: ${renderHook(last)}`] : []),
            ],
          }));
        }
        runStart = null;
      }
    }

    for (let chapter = 1; chapter <= end; chapter++) {
      const opened = onPage.filter((hook) => hook.startChapter > 0 && hookStart(hook) === chapter);
      if (opened.length <= maxNew) continue;
      findings.push(structureFinding(this, {
        chapter, severity: "note",
        summary: `ch${chapter} opens ${opened.length} questions at once.`,
        evidence: opened.map((hook) => `opened: ${hookPromise(hook)} (${hook.hookId})`),
      }));
    }
    return findings;
  },
};
