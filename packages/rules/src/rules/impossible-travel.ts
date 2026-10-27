import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { chapterTimes, type ChapterTime } from "../time.js";
import { TravelGraph } from "../travel.js";
import { factFinding, firstOverlap, groupBy, nested, normalize, normalizeValue } from "./facts.js";
import { isLocationFact } from "./two-places-at-once.js";

// A character's consecutive locations, against the fastest routes in the book's
// `travel.json` and the story time between them. Facts only place a move to a
// chapter, so the time allowed is generous: from the chapter where the first
// location is stated to the end of the chapter where the second is, counting
// every marker in both. When nothing says how much time passed, the move is not
// judged at all: chapters often skip days without a word, and a skipped check
// costs less than a false alarm.
//
// Option `sameChapterHours` (off by default) also flags a move within one
// chapter that states no time at all, when the route takes longer than this many
// hours. It is off because settlers rarely record a time fact for a journey the
// prose summarises ("by the time they reached the capital…").

// A location that is a journey or a vicinity, not a place: "on the road to the capital" is not the capital.
const IN_TRANSIT = /\b(on the (road|way)|en route|heading|bound for|towards?|travel(l)?ing|journey|outside|near|beyond|between)\b|途中|路上|前往|赶往|去往|附近|之间|郊外|城外/u;

type Bound = { readonly hours: number; readonly cited: CurrentStateFact[] };

/** The most story time that can pass from chapter `from` to the end of chapter `to`, or null when unknown. */
function elapsedBetween(times: Map<number, ChapterTime>, from: number, to: number): Bound | null {
  const chapters = Array.from({ length: to - from + 1 }, (_, i) => times.get(from + i));
  const markers = chapters.flatMap((time) => time?.markers ?? []);
  // A scene that looks back ("twenty years ago") puts its facts at another time.
  if (markers.some((m) => m.elapsed.direction === "earlier")) return null;
  const markerHours = (list: typeof markers) => list.reduce((sum, m) => sum + m.elapsed.maxHours, 0);
  const bounds: Bound[] = [];

  // Dated chapters: from the earliest date at the start to the latest at the end,
  // plus any marked time inside those two chapters that the dates do not cover.
  const start = times.get(from)?.dates ?? [];
  const end = times.get(to)?.dates ?? [];
  if (start.length > 0 && end.length > 0) {
    const first = start.reduce((a, b) => (b.range.start < a.range.start ? b : a));
    const last = end.reduce((a, b) => (b.range.end > a.range.end ? b : a));
    const inside = [...(times.get(from)?.markers ?? []), ...(from === to ? [] : times.get(to)?.markers ?? [])];
    // A date that goes backwards is timeline-order's finding, not a journey.
    if (last.range.end > first.range.start) {
      bounds.push({ hours: last.range.end - first.range.start + markerHours(inside), cited: [first.fact, last.fact, ...inside.map((m) => m.fact)] });
    }
  }

  // Marked chapters: every chapter after the first says how much time passed.
  const marked = from === to ? markers.length > 0 : chapters.slice(1).every((time) => (time?.markers.length ?? 0) > 0);
  if (marked) bounds.push({ hours: markerHours(markers), cited: markers.map((m) => m.fact) });

  if (bounds.length === 0) return null;
  // Two bounds both hold, but either may rest on a misread fact: take the looser.
  return bounds.reduce((a, b) => (b.hours > a.hours ? b : a));
}

/** "36 hours", "3 days", "2.5 days". */
export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} hours`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}

/** Location facts in story order: by chapter, then the one superseded first, then position in the text. */
const storyOrder = (a: CurrentStateFact, b: CurrentStateFact) =>
  a.validFromChapter - b.validFromChapter
  || (a.validUntilChapter ?? Infinity) - (b.validUntilChapter ?? Infinity)
  || (a.evidence?.start ?? 0) - (b.evidence?.start ?? 0);

export const impossibleTravel: Rule = {
  id: "continuity/impossible-travel",
  layer: "continuity",
  title: "Impossible travel",
  rationale: "A character cannot get somewhere faster than the book's own travel times allow. A move between places that takes longer than the story time between them means a missing time skip, a wrong place, or a route the travel graph does not know.",
  check({ snapshot, book, options }) {
    if (!book?.travel) return [];
    const graph = new TravelGraph(book.travel);
    const times = chapterTimes(snapshot.currentState.facts);
    const sameChapterHours = typeof options.sameChapterHours === "number" ? options.sameChapterHours : null;
    const diagnostics: Diagnostic[] = [];

    const located = snapshot.currentState.facts.filter(isLocationFact);
    for (const facts of groupBy(located, (fact) => normalize(fact.subject)).values()) {
      const ordered = [...facts].sort(storyOrder);
      for (let i = 1; i < ordered.length; i += 1) {
        const before = ordered[i - 1]!;
        const after = ordered[i]!;
        // Both valid at once is two-places-at-once's finding; a place inside the other is no journey.
        if (firstOverlap(before, after) !== null) continue;
        if (nested(normalizeValue(before.object), normalizeValue(after.object))) continue;
        if (IN_TRANSIT.test(before.object.toLowerCase()) || IN_TRANSIT.test(after.object.toLowerCase())) continue;
        const from = graph.resolve(before.object);
        const to = graph.resolve(after.object);
        if (from === null || to === null || from === to) continue;
        const needed = graph.hours(from, to);
        if (!Number.isFinite(needed) || needed === 0) continue;

        const a = before.validFromChapter;
        const b = after.validFromChapter;
        const route = `${graph.display(from)} to ${graph.display(to)}`;
        const elapsed = elapsedBetween(times, a, b);
        if (elapsed) {
          if (needed <= elapsed.hours) continue;
          diagnostics.push(factFinding(this, {
            chapter: b,
            summary: `${after.subject} gets from ${before.object} (ch${a}) to ${after.object} (ch${b}) in at most ${formatHours(elapsed.hours)} of story time, but the fastest route from ${route} in travel.json takes ${formatHours(needed)}.`,
            evidence: [["from", before], ["to", after], ...elapsed.cited.map((fact) => ["time", fact] as const)],
          }));
        } else if (a === b && sameChapterHours !== null && needed > sameChapterHours) {
          diagnostics.push(factFinding(this, {
            chapter: b,
            summary: `${after.subject} gets from ${before.object} to ${after.object} within chapter ${b}, with no time marked, but the fastest route from ${route} in travel.json takes ${formatHours(needed)}.`,
            evidence: [["from", before], ["to", after]],
          }));
        }
      }
    }
    return diagnostics;
  },
};
