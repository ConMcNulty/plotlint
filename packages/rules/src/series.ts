import { z } from "zod";
import type { CurrentStateFact, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { BookRuleData } from "./book.js";
import type { InvariantsFile } from "./invariants.js";
import { factKind } from "./predicates.js";
import { normalize, renderFact } from "./rules/facts.js";
import type { TravelFile } from "./travel.js";

// The series bible (PLAN, "Series bible"): book three checked against books one
// and two. A book names the books before it in `story/plotlint/series.json`; their
// state at the end of each book is carried into this one as facts valid from
// chapter 0 ("before this book"), so every continuity rule sees them: a character
// who died in book one acting in book three is the same finding as within one book.
// A carried fact ends where this book first records the same thing again (the
// same subject and predicate, or the same value for possessions, knowledge and
// relationships, which can hold several at once), as the settler would. The earlier
// books' approved invariants and travel times apply too, unless this book overrides
// them. Browser-safe; loading is in node.ts.

export const SeriesFileSchema = z.object({
  version: z.literal(1),
  /** The earlier books in reading order, by book id. */
  after: z.array(z.string().min(1)).default([]),
}).strict();
export type SeriesFile = z.infer<typeof SeriesFileSchema>;

export interface SeriesBook {
  readonly id: string;
  readonly title: string;
  readonly snapshot: RuntimeStateSnapshot;
  readonly rules?: BookRuleData;
}

/** A fact carried from an earlier book: where it came from. */
export interface CarriedFact {
  readonly fact: CurrentStateFact;
  readonly book: string;
  readonly title: string;
  /** The chapter of that book that established it. */
  readonly chapter: number;
}

export interface SeriesPrelude {
  readonly books: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly facts: CarriedFact[];
  readonly invariants?: InvariantsFile;
  readonly travel?: TravelFile;
}

const MULTI = new Set(["possession", "knowledge", "relationship", "trait", "goal", "world_rule", "other"]);
const keyOf = (fact: CurrentStateFact) =>
  `${normalize(fact.subject)}\u0000${normalize(fact.predicate)}${MULTI.has(factKind(fact)) ? `\u0000${normalize(fact.object)}` : ""}`;

const UNIT_HOURS = { minutes: 1 / 60, hours: 1, days: 24 } as const;

/** What the earlier books leave standing, in reading order: later books supersede earlier ones. */
export function seriesPrelude(books: ReadonlyArray<SeriesBook>): SeriesPrelude {
  const carried = new Map<string, CarriedFact>();
  const invariants = new Map<string, InvariantsFile["invariants"][number]>();
  let travel: TravelFile | undefined;
  for (const book of books) {
    for (const fact of book.snapshot.currentState.facts) carried.delete(keyOf(fact));
    for (const fact of book.snapshot.currentState.facts) {
      if (fact.validUntilChapter !== null) continue;
      carried.set(keyOf(fact), { fact, book: book.id, title: book.title, chapter: fact.validFromChapter });
    }
    for (const invariant of book.rules?.invariants?.invariants ?? []) if (invariant.status === "approved") invariants.set(invariant.id, invariant);
    const own = book.rules?.travel;
    if (own) {
      const unit = travel?.unit ?? own.unit;
      const scale = UNIT_HOURS[own.unit] / UNIT_HOURS[unit];
      travel = {
        version: 1,
        unit,
        places: { ...(travel?.places ?? {}), ...own.places },
        routes: [...(travel?.routes ?? []), ...own.routes.map((route) => ({ ...route, time: route.time * scale }))],
      };
    }
  }
  return {
    books: books.map(({ id, title }) => ({ id, title })),
    facts: [...carried.values()],
    ...(invariants.size ? { invariants: { version: 1 as const, invariants: [...invariants.values()] } } : {}),
    ...(travel ? { travel } : {}),
  };
}

/** The carried fact as this book sees it: from chapter 0 until this book records the same thing. */
function carry(entry: CarriedFact, until: number | null): CurrentStateFact {
  const { evidence: _evidence, endEvidence: _endEvidence, ...fact } = entry.fact;
  return { ...fact, validFromChapter: 0, sourceChapter: 0, validUntilChapter: until };
}

/**
 * This book's snapshot with the earlier books' facts in front, and its rule data with
 * their invariants and travel times beneath its own. Returns the carried facts as this
 * book sees them, for `explainSeriesFindings`.
 */
export function withSeries(snapshot: RuntimeStateSnapshot, rules: BookRuleData, prelude: SeriesPrelude): {
  snapshot: RuntimeStateSnapshot; rules: BookRuleData; carried: Array<CarriedFact & { readonly as: CurrentStateFact }>;
} {
  const firstSeen = new Map<string, number>();
  for (const fact of snapshot.currentState.facts) {
    const key = keyOf(fact);
    firstSeen.set(key, Math.min(firstSeen.get(key) ?? Infinity, fact.validFromChapter));
  }
  const carried = prelude.facts.map((entry) => {
    const seen = firstSeen.get(keyOf(entry.fact));
    return { ...entry, as: carry(entry, seen === undefined ? null : Math.max(0, seen - 1)) };
  });
  const ownInvariants = rules.invariants?.invariants ?? [];
  const invariants = [...(prelude.invariants?.invariants ?? []).filter((inv) => !ownInvariants.some((own) => own.id === inv.id)), ...ownInvariants];
  const travel = prelude.travel && rules.travel
    ? { ...rules.travel, places: { ...prelude.travel.places, ...rules.travel.places }, routes: [...prelude.travel.routes.map((route) => ({ ...route, time: route.time * UNIT_HOURS[prelude.travel!.unit] / UNIT_HOURS[rules.travel!.unit] })), ...rules.travel.routes] }
    : rules.travel ?? prelude.travel;
  return {
    snapshot: { ...snapshot, currentState: { ...snapshot.currentState, facts: [...carried.map((entry) => entry.as), ...snapshot.currentState.facts] } },
    rules: { ...rules, ...(invariants.length ? { invariants: { version: 1, invariants } } : {}), ...(travel ? { travel } : {}) },
    carried,
  };
}

const same = (a: CurrentStateFact, b: CurrentStateFact) =>
  a.subject === b.subject && a.predicate === b.predicate && a.object === b.object && a.validFromChapter === b.validFromChapter && a.sourceChapter === b.sourceChapter;

/**
 * Findings that cite a carried fact say where it came from: "chapter 0" becomes the
 * earlier book, and the cited fact names that book's chapter.
 */
export function explainSeriesFindings(diagnostics: ReadonlyArray<Diagnostic>, carried: ReadonlyArray<CarriedFact & { readonly as: CurrentStateFact }>): Diagnostic[] {
  if (!carried.length) return [...diagnostics];
  return diagnostics.map((diagnostic) => {
    const cited = (diagnostic.facts ?? []).map((fact) => carried.find((entry) => same(entry.as, fact))).filter((entry) => entry !== undefined);
    if (!cited.length) return diagnostic;
    const where = (entry: CarriedFact) => `${entry.title}, ch${entry.chapter}`;
    let evidence = diagnostic.evidence;
    for (const entry of cited) {
      const rendered = renderFact(entry.as);
      evidence = evidence.map((line) => line.replace(rendered, `${entry.as.subject} · ${entry.as.predicate} · ${entry.as.object} (carried from ${where(entry)})`));
    }
    const origin = [...new Set(cited.map((entry) => entry.title))].join(", ");
    const summary = diagnostic.summary.replace(/\bchapter 0\b|\bch0\b/gu, origin);
    return { ...diagnostic, summary, evidence };
  });
}
