import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { chapterTimes, readAge, readBirthYear, seasonMonths, type ChapterTime, type Hemisphere } from "../time.js";
import { factFinding, firstOverlap, groupBy, normalize } from "./facts.js";

// Time markers that cannot all be true of the main timeline (flashbacks, dreams
// and stories within the story are already left out, see frames.ts):
//
// - the story's date goes backwards from one dated chapter to the next;
// - a stated season falls outside the months stated in the same chapter;
// - an age does not match a stated birth year and the story's year;
// - a character's age goes down from one chapter to a later one.
//
// Two ages valid at once are single-valued-conflict's finding and are not repeated.
// A chapter that itself looks back ("twenty years ago", "二十年前") is skipped,
// since its facts may describe the past. Option `hemisphere: "south"` swaps the seasons.

/** A chapter whose facts may be set in the past: it states time that lies behind the scene. */
const looksBack = (time: ChapterTime | undefined) => time?.markers.some((m) => m.elapsed.direction === "earlier") ?? false;

/** A chapter that skips weeks or more: its season and its months may be either side of the skip. */
const skipsAhead = (time: ChapterTime) => time.markers.some((m) => m.elapsed.maxHours > 30 * 24);

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const timelineOrder: Rule = {
  id: "continuity/timeline-order",
  layer: "continuity",
  title: "Timeline out of order",
  rationale: "Dates, seasons and ages pin a story to a calendar. A date that goes backwards, a winter in July or an age that does not match a birth year confuses readers unless it is a marked flashback.",
  check({ snapshot, options }) {
    const hemisphere: Hemisphere = options.hemisphere === "south" ? "south" : "north";
    const facts = snapshot.currentState.facts;
    const times = chapterTimes(facts, hemisphere);
    const chapters = [...times.keys()].sort((a, b) => a - b);
    const diagnostics: Diagnostic[] = [];

    // Dates going backwards: compare each dated chapter with the dated chapter before
    // it only, so one misplaced chapter is one finding, not one per later chapter.
    let previous: { chapter: number; first: ChapterTime["dates"][number] } | undefined;
    for (const chapter of chapters) {
      const time = times.get(chapter)!;
      // A chapter that looks back neither breaks the order nor sets it.
      if (time.dates.length === 0 || looksBack(time)) continue;
      const first = time.dates.reduce((a, b) => (b.range.start < a.range.start ? b : a));
      const last = time.dates.reduce((a, b) => (b.range.end > a.range.end ? b : a));
      // Ranges are inclusive of all a vague date can mean, so "1891" then "March 1891" is not backwards.
      if (previous && last.range.end <= previous.first.range.start) {
        diagnostics.push(factFinding(this, {
          chapter,
          summary: `The story's date goes backwards in chapter ${chapter}: ${last.fact.object}, after ${previous.first.fact.object} in chapter ${previous.chapter}. If chapter ${chapter} is a flashback, mark it in frames.json.`,
          evidence: [["date", last.fact], ["earlier date", previous.first.fact]],
        }));
      }
      previous = { chapter, first };
    }

    // Season against month, within one chapter.
    for (const chapter of chapters) {
      const time = times.get(chapter)!;
      if (skipsAhead(time)) continue;
      // A season reached by a skip ("the following spring") is not the season of the chapter's dates.
      const seasons = time.readings.filter(({ reading }) => reading.season && !reading.elapsed);
      const months = time.readings.filter(({ reading }) => reading.month !== undefined);
      if (seasons.length === 0 || months.length === 0) continue;
      for (const { fact, reading } of seasons) {
        const allowed = seasonMonths(reading.season!, hemisphere);
        if (months.some((m) => allowed.has(m.reading.month!))) continue;
        const month = months[0]!;
        const sameFact = month.fact === fact;
        diagnostics.push(factFinding(this, {
          chapter,
          summary: `Chapter ${chapter} is set in ${reading.season} but in ${MONTH_NAMES[month.reading.month! - 1]}, which is not ${reading.season} in the ${hemisphere}ern hemisphere.`,
          evidence: sameFact ? [["season and month", fact]] : [["season", fact], ["month", month.fact]],
        }));
        break;
      }
    }

    const ages = facts
      .map((fact) => ({ fact, age: readAge(fact) }))
      .filter((entry): entry is { fact: CurrentStateFact; age: number } => entry.age !== null);
    const births = groupBy(
      facts.map((fact) => ({ fact, year: readBirthYear(fact) })).filter((entry): entry is { fact: CurrentStateFact; year: number } => entry.year !== null),
      (entry) => normalize(entry.fact.subject),
    );

    // Age against birth year and the story's year.
    for (const { fact, age } of ages) {
      const birth = births.get(normalize(fact.subject));
      // Two different birth years: which one is wrong is not ours to say.
      if (!birth || new Set(birth.map((b) => b.year)).size !== 1) continue;
      const born = birth[0]!;
      const chapter = fact.validFromChapter;
      if (looksBack(times.get(chapter))) continue;
      // East Asian ages (岁) often count one more year; allow it.
      const extra = /岁/u.test(fact.object) ? 1 : 0;
      const sameChapter = (times.get(chapter)?.readings ?? []).filter(({ reading }) => reading.year !== undefined);
      if (sameChapter.length > 0) {
        const years = sameChapter.map(({ reading }) => reading.year!);
        const low = Math.min(...years) - born.year - 1;
        const high = Math.max(...years) - born.year + extra;
        if (age >= low && age <= high) continue;
        const year = sameChapter[0]!;
        const expected = year.reading.year! - born.year;
        diagnostics.push(factFinding(this, {
          chapter,
          summary: `${fact.subject} is ${age} in chapter ${chapter}, but born in ${born.year} they would be ${expected - 1} or ${expected} in ${year.reading.year}.`,
          evidence: [["age", fact], ["born", born.fact], ["year", year.fact]],
        }));
        continue;
      }
      // Only an earlier year: time may have passed since, so the age can only be too low.
      const earlier = chapters.filter((c) => c < chapter).reverse()
        .filter((c) => !looksBack(times.get(c)))
        .map((c) => times.get(c)!.readings.find(({ reading }) => reading.year !== undefined))
        .find(Boolean);
      if (!earlier) continue;
      const least = earlier.reading.year! - born.year - 1;
      if (age >= least) continue;
      diagnostics.push(factFinding(this, {
        chapter,
        summary: `${fact.subject} is ${age} in chapter ${chapter}, but born in ${born.year} they were already at least ${least} by ${earlier.reading.year} (chapter ${earlier.fact.validFromChapter}).`,
        evidence: [["age", fact], ["born", born.fact], ["year", earlier.fact]],
      }));
    }

    // Ages going down: each age against the character's previous one.
    for (const group of groupBy(ages, (entry) => normalize(entry.fact.subject)).values()) {
      const ordered = [...group].sort((a, b) => a.fact.validFromChapter - b.fact.validFromChapter);
      for (let i = 1; i < ordered.length; i += 1) {
        const before = ordered[i - 1]!;
        const after = ordered[i]!;
        if (after.fact.validFromChapter <= before.fact.validFromChapter) continue;
        if (firstOverlap(before.fact, after.fact) !== null) continue;
        if (after.age >= before.age || looksBack(times.get(after.fact.validFromChapter))) continue;
        diagnostics.push(factFinding(this, {
          chapter: after.fact.validFromChapter,
          summary: `${after.fact.subject} is ${after.age} in chapter ${after.fact.validFromChapter}, younger than the ${before.age} recorded in chapter ${before.fact.validFromChapter}.`,
          evidence: [["age", after.fact], ["earlier age", before.fact]],
        }));
      }
    }
    return diagnostics;
  },
};
