import { locateQuote, type CurrentStateFact, type FactEvidence, type FactKind, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import { normalize, normalizeValue } from "./rules/facts.js";
import { sceneAt, segmentScenes, type Scene } from "./scenes.js";
import { factKind } from "./predicates.js";

// Evidence spans over the settler's facts: where each fact is established and
// ended in today's chapter text, what holds at a cursor, and where a name is
// first defined. Chapter text is the chapter file as saved (heading included);
// the settler's offsets are into the body it settled, so the quote is the
// anchor and the offsets only break ties between repeated passages.

/** The current text of each chapter by number. */
export type ChapterTexts = ReadonlyMap<number, string>;

export interface EvidenceLocation {
  readonly chapter: number;
  readonly start: number;
  readonly end: number;
  /** The passage as it reads in the chapter today. */
  readonly quote: string;
  /** `ch<chapter>.s<n>` from `segmentScenes`. */
  readonly scene?: string;
}

export type EvidenceStatus =
  /** The quote is in the chapter text. */
  | "valid"
  /** The settler cited a quote, but it is not in the chapter text (a bad quote, or the text was edited). */
  | "not-found"
  /** The settler cited nothing, e.g. state settled before evidence spans existed. */
  | "uncited"
  /** The chapter's text is not available. */
  | "no-chapter";

// Scene segmentation per chapter, recomputed when the chapter's text changes:
// an editor may update one ChapterTexts map in place as the writer types.
const sceneCache = new WeakMap<ChapterTexts, Map<number, { text: string; scenes: Scene[] }>>();
function scenesOf(chapters: ChapterTexts, chapter: number): Scene[] {
  let byChapter = sceneCache.get(chapters);
  if (!byChapter) sceneCache.set(chapters, byChapter = new Map());
  const text = chapters.get(chapter) ?? "";
  let cached = byChapter.get(chapter);
  if (cached?.text !== text) byChapter.set(chapter, cached = { text, scenes: segmentScenes(text, { chapter }) });
  return cached.scenes;
}

// The settler's offsets count from the start of the body it settled; the chapter
// file puts the "# Chapter N: Title" heading and a blank line before that body.
const HEADING = /^#[^\n]*\n(?:[ \t]*\r?\n)*/u;
const bodyOffset = (text: string) => HEADING.exec(text)?.[0].length ?? 0;

/** Locate one evidence record in a chapter's current text. */
export function locateEvidence(
  evidence: FactEvidence | undefined,
  chapter: number,
  chapters: ChapterTexts,
): { status: EvidenceStatus; location?: EvidenceLocation } {
  if (!evidence) return { status: "uncited" };
  const text = chapters.get(chapter);
  if (text === undefined) return { status: "no-chapter" };
  const span = locateQuote(text, evidence.quote, evidence.start === undefined ? {} : { near: bodyOffset(text) + evidence.start });
  if (!span) return { status: "not-found" };
  return {
    status: "valid",
    location: {
      chapter,
      start: span.start,
      end: span.end,
      quote: text.slice(span.start, span.end),
      scene: sceneAt(scenesOf(chapters, chapter), span.start)?.id,
    },
  };
}

/** Where a fact was established: its evidence in its source chapter. */
export const establishedAt = (fact: CurrentStateFact, chapters: ChapterTexts) =>
  locateEvidence(fact.evidence, fact.sourceChapter, chapters);

/** Where a fact was ended: its end evidence in the chapter after its last valid chapter. Null while it is still valid. */
export const endedAt = (fact: CurrentStateFact, chapters: ChapterTexts) =>
  fact.validUntilChapter === null ? null : locateEvidence(fact.endEvidence, fact.validUntilChapter + 1, chapters);

// --- Coverage: the phase 2 gate counts fact ops whose span validates. ---

export interface EvidenceIssue {
  readonly op: "upsert" | "expire";
  readonly status: Exclude<EvidenceStatus, "valid">;
  readonly chapter: number;
  readonly fact: CurrentStateFact;
}

export interface EvidenceCoverage {
  /** Fact ops counted: one upsert per fact, plus one expiry per fact that has ended. */
  readonly total: number;
  readonly valid: number;
  /** valid / total, or 1 when there are no fact ops. */
  readonly ratio: number;
  readonly byStatus: Readonly<Record<EvidenceStatus, number>>;
  readonly byChapter: ReadonlyArray<{ chapter: number; total: number; valid: number }>;
  readonly issues: ReadonlyArray<EvidenceIssue>;
}

/** Count the fact ops in a snapshot whose evidence validates against today's chapter text. */
export function evidenceCoverage(snapshot: RuntimeStateSnapshot, chapters: ChapterTexts): EvidenceCoverage {
  const byStatus: Record<EvidenceStatus, number> = { valid: 0, "not-found": 0, uncited: 0, "no-chapter": 0 };
  const perChapter = new Map<number, { total: number; valid: number }>();
  const issues: EvidenceIssue[] = [];
  const count = (op: EvidenceIssue["op"], chapter: number, fact: CurrentStateFact, status: EvidenceStatus) => {
    byStatus[status] += 1;
    const row = perChapter.get(chapter) ?? { total: 0, valid: 0 };
    row.total += 1;
    if (status === "valid") row.valid += 1;
    else issues.push({ op, status, chapter, fact });
    perChapter.set(chapter, row);
  };
  for (const fact of snapshot.currentState.facts) {
    count("upsert", fact.sourceChapter, fact, establishedAt(fact, chapters).status);
    const ended = endedAt(fact, chapters);
    if (ended) count("expire", fact.validUntilChapter! + 1, fact, ended.status);
  }
  const total = [...perChapter.values()].reduce((sum, row) => sum + row.total, 0);
  return {
    total,
    valid: byStatus.valid,
    ratio: total === 0 ? 1 : byStatus.valid / total,
    byStatus,
    byChapter: [...perChapter.entries()].sort(([a], [b]) => a - b).map(([chapter, row]) => ({ chapter, ...row })),
    issues,
  };
}

// --- State at cursor ---

export interface CursorPosition {
  readonly chapter: number;
  /** Offset into that chapter's current text. */
  readonly offset: number;
}

export interface FactAtCursor {
  readonly fact: CurrentStateFact;
  readonly kind: FactKind;
  /** Where the fact was established, when its evidence is located. */
  readonly established?: EvidenceLocation;
  /** True when the fact starts in the cursor's chapter but its passage cannot be located, so it may not hold yet. */
  readonly unanchored?: boolean;
}

export interface EntityAtCursor {
  readonly subject: string;
  readonly facts: ReadonlyArray<FactAtCursor>;
}

/**
 * The world as of a cursor: every fact that holds at that point, grouped by subject.
 * A fact from an earlier chapter holds unless it ended before the cursor; a fact from
 * the cursor's chapter holds once the cursor is past the start of its passage.
 */
export function stateAt(snapshot: RuntimeStateSnapshot, cursor: CursorPosition, chapters: ChapterTexts): EntityAtCursor[] {
  const holding: FactAtCursor[] = [];
  for (const fact of snapshot.currentState.facts) {
    if (fact.validFromChapter > cursor.chapter) continue;
    // Ended before the cursor's chapter, or in it at a passage before the cursor.
    if (fact.validUntilChapter !== null && fact.validUntilChapter < cursor.chapter) {
      if (fact.validUntilChapter + 1 < cursor.chapter) continue;
      const end = endedAt(fact, chapters)?.location;
      if (!end || end.start <= cursor.offset) continue;
    }
    const established = establishedAt(fact, chapters).location;
    if (fact.sourceChapter === cursor.chapter && fact.validFromChapter === cursor.chapter) {
      if (established && established.start > cursor.offset) continue;
      holding.push({ fact, kind: factKind(fact), ...(established ? { established } : { unanchored: true }) });
      continue;
    }
    holding.push({ fact, kind: factKind(fact), ...(established ? { established } : {}) });
  }
  // Group as the rules do ("Mira" = "mira"), under the first spelling seen.
  const bySubject = new Map<string, { subject: string; facts: FactAtCursor[] }>();
  for (const entry of holding) {
    const key = normalize(entry.fact.subject);
    const group = bySubject.get(key) ?? { subject: entry.fact.subject, facts: [] };
    group.facts.push(entry);
    bySubject.set(key, group);
  }
  return [...bySubject.values()]
    .sort((a, b) => a.subject.localeCompare(b.subject))
    .map(({ subject, facts }) => ({
      subject,
      facts: facts.sort((a, b) => a.kind.localeCompare(b.kind) || a.fact.predicate.localeCompare(b.fact.predicate)),
    }));
}

// --- Go to definition ---

export interface Definition {
  /** The entity the name resolved to, as the state spells it. */
  readonly entity: string;
  /** Whether the name matched a fact's subject or only its object (a place or item). */
  readonly role: "subject" | "object";
  readonly fact: CurrentStateFact;
  readonly location: EvidenceLocation;
}

/**
 * Where a name (a character, place or item) is first established in the text,
 * followed by every later fact about it that has a located passage, in reading order.
 * Subject matches come before object matches. Empty when nothing matches or no
 * matching fact has a located passage.
 */
export function findDefinitions(snapshot: RuntimeStateSnapshot, name: string, chapters: ChapterTexts): Definition[] {
  const key = normalizeValue(name);
  if (!key) return [];
  const matches = (value: string) => normalizeValue(value) === key || normalize(value) === normalize(name);
  const found: Definition[] = [];
  for (const fact of snapshot.currentState.facts) {
    const role = matches(fact.subject) ? "subject" : matches(fact.object) ? "object" : null;
    if (!role) continue;
    const location = establishedAt(fact, chapters).location;
    if (location) found.push({ entity: role === "subject" ? fact.subject : fact.object, role, fact, location });
  }
  return found.sort((a, b) =>
    (a.role === b.role ? 0 : a.role === "subject" ? -1 : 1)
    || a.location.chapter - b.location.chapter
    || a.location.start - b.location.start);
}
