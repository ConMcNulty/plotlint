import type { CurrentStateFact, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import { hookStatusRows, type HookOverlayFile, type HookStatusRow } from "./hook-overlay.js";
import { bookEnd, hookStart } from "./rules/structure/common.js";
import { chapterTimes, type Hemisphere } from "./time.js";
import type { ChapterTexts } from "./evidence.js";

// Views beyond the page (PLAN, "Views beyond the page"): the hook board (open
// promises and their age) and the timeline (story time across chapters, with the
// continuity findings that break it). Both are built from the settled state and the
// findings the rules already report, so a board never disagrees with the problems
// panel; every card names the chapter to open. Browser-safe.

export type HookColumn = "open" | "resolved" | "dropped";

export interface HookCard extends HookStatusRow {
  readonly column: HookColumn;
  /** Chapters since the hook last moved, for open hooks: how long the reader has waited. */
  readonly age: number | null;
  /** Never planted or advanced on the page (seeded from the outline only). */
  readonly offPage: boolean;
  /** Structure findings that name this hook. */
  readonly findings: Diagnostic[];
}

export interface HookBoard {
  readonly end: number;
  readonly cards: HookCard[];
  /** Open hooks per chapter 1..end, the curve the open-questions check reads. */
  readonly openPerChapter: number[];
}

const HOOK_RULES = new Set(["structure/open-questions", "structure/unpaid-setup", "structure/unearned-payoff", "structure/subplot-balance"]);

const mentions = (diagnostic: Diagnostic, id: string) =>
  [diagnostic.summary, ...diagnostic.evidence].some((line) => line.includes(`(${id})`) || line.includes(`"${id}"`) || line.includes(` ${id}:`) || line.endsWith(` ${id}`));

/** The hook ledger as a board: open hooks oldest first, then resolved, then dropped (superseded). */
export function hookBoard(snapshot: RuntimeStateSnapshot, overlay: HookOverlayFile | undefined, chapters: ChapterTexts, diagnostics: ReadonlyArray<Diagnostic> = []): HookBoard {
  const end = bookEnd(snapshot, chapters);
  const relevant = diagnostics.filter((diagnostic) => HOOK_RULES.has(diagnostic.ruleId));
  const records = new Map(snapshot.hooks.hooks.map((hook) => [hook.hookId, hook]));
  const cards = hookStatusRows(snapshot, overlay, chapters).map((row): HookCard => {
    const column: HookColumn = row.effective === "resolved" ? "resolved" : row.effective === "superseded" ? "dropped" : "open";
    const offPage = hookStart(records.get(row.id)!) === null;
    return {
      ...row,
      column,
      age: column === "open" && !offPage ? Math.max(0, end - Math.max(row.opened, row.lastAdvanced)) : null,
      offPage,
      findings: relevant.filter((diagnostic) => mentions(diagnostic, row.id)),
    };
  });
  const order: Record<HookColumn, number> = { open: 0, resolved: 1, dropped: 2 };
  cards.sort((a, b) => order[a.column] - order[b.column] || (b.age ?? -1) - (a.age ?? -1) || a.opened - b.opened);
  const openPerChapter = Array.from({ length: end + 1 }, () => 0);
  for (const card of cards) {
    if (card.offPage) continue;
    const from = card.opened > 0 ? card.opened : card.lastAdvanced;
    const to = card.column === "open" ? end : card.column === "resolved" ? Math.max(from, (card.resolvedIn ?? card.lastAdvanced) - 1) : Math.max(from, card.lastAdvanced);
    for (let chapter = from; chapter <= Math.min(to, end); chapter++) openPerChapter[chapter]! += 1;
  }
  return { end, cards, openPerChapter };
}

export interface TimelineMark {
  /** The fact as the settler recorded it, e.g. "Nell / date / 3 March 1891". */
  readonly label: string;
  readonly fact: CurrentStateFact;
}

export interface TimelineChapter {
  readonly chapter: number;
  /** Story time at the chapter's start, in hours on the calendar the time module uses; null when it cannot be told. */
  readonly at: number | null;
  /** How `at` was found: a date in the chapter, time passed since the last known point, or not at all. */
  readonly basis: "date" | "elapsed" | "unknown";
  /** The chapter looks back ("twenty years ago"), so it does not move the story clock. */
  readonly looksBack: boolean;
  readonly dates: TimelineMark[];
  readonly markers: TimelineMark[];
  /** Timeline and travel findings for this chapter. */
  readonly conflicts: Diagnostic[];
}

export interface Timeline {
  readonly chapters: TimelineChapter[];
  /** Findings without a chapter, shown apart. */
  readonly unplaced: Diagnostic[];
}

const TIME_RULES = new Set(["continuity/timeline-order", "continuity/impossible-travel"]);
const label = (fact: CurrentStateFact) => `${fact.subject} / ${fact.predicate} / ${fact.object}`;

/**
 * Story time chapter by chapter. A chapter with a date sits at its earliest date; one
 * without moves on from the last known point by the time it says passes ("three days
 * later"); a chapter that looks back keeps the clock where it was. The positions are
 * estimates for drawing; the conflicts are the rules' own findings.
 */
export function timeline(snapshot: RuntimeStateSnapshot, chapters: ChapterTexts, diagnostics: ReadonlyArray<Diagnostic> = [], hemisphere: Hemisphere = "north"): Timeline {
  const times = chapterTimes(snapshot.currentState.facts, hemisphere);
  const conflicts = diagnostics.filter((diagnostic) => TIME_RULES.has(diagnostic.ruleId));
  const numbers = [...new Set([...chapters.keys(), ...times.keys()])].filter((chapter) => chapter > 0).sort((a, b) => a - b);
  let clock: number | null = null;
  const out = numbers.map((chapter): TimelineChapter => {
    const time = times.get(chapter);
    const looksBack = time?.markers.some((marker) => marker.elapsed.direction === "earlier") ?? false;
    const later = time?.markers.filter((marker) => marker.elapsed.direction === "later") ?? [];
    let at: number | null = null;
    let basis: TimelineChapter["basis"] = "unknown";
    if (time && time.dates.length && !looksBack) {
      at = Math.min(...time.dates.map((date) => date.range.start));
      basis = "date";
      clock = at;
    } else if (!looksBack && clock !== null) {
      clock += later.reduce((sum, marker) => sum + marker.elapsed.hours, 0);
      at = clock;
      basis = later.length ? "elapsed" : "unknown";
      if (basis === "unknown") at = null;
    }
    return {
      chapter,
      at,
      basis,
      looksBack,
      dates: (time?.dates ?? []).map(({ fact }) => ({ label: label(fact), fact })),
      markers: (time?.markers ?? []).map(({ fact }) => ({ label: label(fact), fact })),
      conflicts: conflicts.filter((diagnostic) => diagnostic.chapter === chapter),
    };
  });
  return { chapters: out, unplaced: conflicts.filter((diagnostic) => diagnostic.chapter === undefined || !numbers.includes(diagnostic.chapter)) };
}
