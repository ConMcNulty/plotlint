import type { CurrentStateFact, FactKind, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import { hookStatusRows, type HookOverlayFile, type HookStatusRow } from "./hook-overlay.js";
import { factKind } from "./predicates.js";
import { normalize } from "./rules/facts.js";
import { tensionCurve } from "./rules/tension-curve.js";
import type { SceneAnnotation } from "./scene-annotations.js";
import { bookEnd, hookStart } from "./rules/structure/common.js";
import { chapterTimes, type Hemisphere } from "./time.js";
import type { ChapterTexts } from "./evidence.js";

// Views beyond the page (PLAN, "Views beyond the page"): the hook board (open
// promises and their age), the timeline (story time across chapters, with the
// continuity findings that break it), the cast board (characters, where they stand
// and how they relate) and the tension curve (judged stakes per chapter). Both are built from the settled state and the
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

/** A relationship standing at the end of the book. */
export interface CastRelation {
  readonly predicate: string;
  readonly object: string;
  /** The cast member the relationship names, when it names one. */
  readonly with: string | null;
  readonly since: number;
}

export interface CastMember {
  readonly name: string;
  /** The first and last chapters with a fact about them or a scene from their viewpoint. */
  readonly firstSeen: number;
  readonly lastSeen: number;
  /** Their standing status ("alive", "dead") and location at the end, when recorded. */
  readonly status: string | null;
  readonly location: string | null;
  readonly povChapters: number[];
  readonly relations: CastRelation[];
  /** How many facts the settler recorded about them, which orders the board. */
  readonly facts: number;
  /** Findings that cite a fact about them. */
  readonly findings: Diagnostic[];
}

// Kinds only a character has; a subject with nothing but a place or a holder is an object or a setting.
const PERSON_KINDS = new Set<FactKind>(["status", "age", "relationship", "goal", "trait", "knowledge", "identity"]);

const latestStanding = (facts: ReadonlyArray<CurrentStateFact>, kind: FactKind) =>
  facts.filter((fact) => fact.validUntilChapter === null && factKind(fact) === kind).sort((a, b) => b.validFromChapter - a.validFromChapter)[0]?.object ?? null;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * The cast: every subject the settler recorded something only a character has, plus
 * every viewpoint character in the scene annotations, with their standing status,
 * location and relationships at the end, and the findings about them.
 */
export function castBoard(snapshot: RuntimeStateSnapshot, scenes: ReadonlyArray<SceneAnnotation> = [], diagnostics: ReadonlyArray<Diagnostic> = []): CastMember[] {
  const bySubject = new Map<string, { name: string; facts: CurrentStateFact[]; pov: Set<number> }>();
  const entry = (name: string) => {
    const key = normalize(name);
    const found = bySubject.get(key) ?? { name: name.trim(), facts: [], pov: new Set<number>() };
    bySubject.set(key, found);
    return found;
  };
  for (const fact of snapshot.currentState.facts) if (fact.subject.trim()) entry(fact.subject).facts.push(fact);
  for (const scene of scenes) if (scene.pov?.trim()) entry(scene.pov).pov.add(scene.chapter);
  const cast = [...bySubject.entries()].filter(([, { facts, pov }]) => pov.size > 0 || facts.some((fact) => PERSON_KINDS.has(factKind(fact))));
  const names = cast.map(([key, { name }]) => ({ key, name, pattern: new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, "iu") }));
  return cast.map(([key, { name, facts, pov }]): CastMember => {
    const seen = [...facts.flatMap((fact) => [fact.validFromChapter, fact.sourceChapter]), ...pov].filter((chapter) => chapter > 0);
    const relations = facts
      .filter((fact) => fact.validUntilChapter === null && factKind(fact) === "relationship")
      .map((fact): CastRelation => ({
        predicate: fact.predicate,
        object: fact.object,
        with: names.find((other) => other.key !== key && other.pattern.test(fact.object))?.name ?? null,
        since: fact.validFromChapter,
      }));
    return {
      name,
      firstSeen: seen.length ? Math.min(...seen) : 0,
      lastSeen: seen.length ? Math.max(...seen) : 0,
      status: latestStanding(facts, "status"),
      location: latestStanding(facts, "location"),
      povChapters: [...pov].sort((a, b) => a - b),
      relations,
      facts: facts.length,
      findings: diagnostics.filter((diagnostic) => (diagnostic.facts ?? []).some((fact) => normalize(fact.subject) === key)),
    };
  }).sort((a, b) => b.facts + b.povChapters.length - (a.facts + a.povChapters.length) || a.firstSeen - b.firstSeen || a.name.localeCompare(b.name));
}

export interface TensionPoint {
  readonly chapter: number;
  /** The highest judged stakes among the chapter's scenes, 0 to 10. */
  readonly stakes: number;
  /** The scene with those stakes, and what its viewpoint character wants there. */
  readonly scene: string;
  readonly pov: string | null;
  readonly goal: string | null;
}

export interface TensionView {
  readonly points: TensionPoint[];
  /** The tension-curve findings: flat runs and an early peak. */
  readonly findings: Diagnostic[];
}

/** The tension curve the `structure/tension-curve` check reads, for drawing. */
export function tensionView(scenes: ReadonlyArray<SceneAnnotation>, diagnostics: ReadonlyArray<Diagnostic> = []): TensionView {
  return {
    points: tensionCurve(scenes).map(({ chapter, stakes, scene }) => ({ chapter, stakes, scene: scene.id, pov: scene.pov, goal: scene.goal })),
    findings: diagnostics.filter((diagnostic) => diagnostic.ruleId === "structure/tension-curve"),
  };
}
