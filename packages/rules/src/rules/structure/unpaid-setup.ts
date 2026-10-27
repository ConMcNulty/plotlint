import type { CurrentStateFact, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { ChapterTexts } from "../../evidence.js";
import type { Rule } from "../../types.js";
import { bookEnd, hookPromise, hookStart, isFinished, lastTouched, numberOption, payoffChapter, renderHook, structureFinding, UNRESOLVED } from "./common.js";
import { characterNames, cleanTerm, factItems, factTerms, mentionsAny, sameTerm, textPhrases } from "./terms.js";

// Setup and payoff: every promise the book makes should be kept. Two kinds of
// promise are read from state alone:
//   - hooks in InkOS's ledger that are never resolved: in a finished book, any
//     hook still open whose last advance is before the final chapter; in an
//     unfinished one, only hooks past their own `paysOffInArc` chapter (plus
//     `grace`) or untouched for `staleAfter` chapters;
//   - tracked objects (Chekhov's gun): a specific item a possession fact
//     introduces and the book emphasises (named in two facts, or the subject of
//     one) that no later fact, summary or chapter text names again.
// A hook the final chapter still advances is an open ending kept on purpose, and
// is left alone unless `flagOpenEndings` is set. Hooks seeded from the outline
// (chapter 0) that no chapter ever advanced were never on the page, so they are
// not setups. Options: `finished` (override the book.json reading), `staleAfter`
// (default 10), `grace` (default 0), `flagOpenEndings` (default false), `items`
// (default true).

const DEFAULT_STALE_AFTER = 10;

interface ItemSetup {
  readonly item: string;
  readonly fact: CurrentStateFact;
  readonly chapter: number;
}

/** The chapters after `after` in which the item is named again: in facts, in summaries, in the prose, or by its fact ending. */
function itemReturns(snapshot: RuntimeStateSnapshot, setup: ItemSetup, chapters: ChapterTexts | undefined, characters: ReadonlySet<string>): number[] {
  const found = new Set<number>();
  const phrases = textPhrases(setup.item, true);
  for (const fact of snapshot.currentState.facts) {
    if (fact.sourceChapter > setup.chapter && (factTerms(fact, characters).some((term) => sameTerm(term, setup.item))
      || mentionsAny(`${fact.subject}\n${fact.object}`, phrases))) found.add(fact.sourceChapter);
    // A possession of the item that ends was changed by the chapter after its last valid one.
    if (fact.validUntilChapter !== null && fact.validUntilChapter >= setup.chapter
      && factItems(fact, characters).some((item) => sameTerm(item, setup.item))) found.add(fact.validUntilChapter + 1);
  }
  for (const row of snapshot.chapterSummaries.rows) {
    if (row.chapter > setup.chapter && mentionsAny(`${row.events}\n${row.stateChanges}\n${row.hookActivity}`, phrases)) found.add(row.chapter);
  }
  for (const [chapter, text] of chapters ?? []) if (chapter > setup.chapter && mentionsAny(text, phrases)) found.add(chapter);
  return [...found];
}

/** Specific items introduced by possession facts and given emphasis, each with the fact that introduces it. */
function trackedItems(snapshot: RuntimeStateSnapshot, characters: ReadonlySet<string>): ItemSetup[] {
  const facts = [...snapshot.currentState.facts].sort((a, b) => a.sourceChapter - b.sourceChapter);
  const setups: ItemSetup[] = [];
  for (const fact of facts) {
    for (const item of factItems(fact, characters)) {
      if (setups.some((setup) => sameTerm(setup.item, item))) continue;
      const naming = facts.filter((other) => factTerms(other, characters).some((term) => sameTerm(term, item)));
      const emphasised = naming.length >= 2 || facts.some((other) => sameTerm(cleanTerm(other.subject), item) && factItems(other, characters).length === 0);
      if (emphasised) setups.push({ item: cleanTerm(item), fact, chapter: fact.sourceChapter });
    }
  }
  return setups;
}

export const unpaidSetup: Rule = {
  id: "structure/unpaid-setup",
  layer: "structure",
  title: "Setups never paid off",
  rationale: "A question the story raises or an object it puts in the reader's hand is a promise. One that never returns leaves the reader waiting for a payoff that does not come; pay it off, cut it, or mark it as an open ending.",
  source: "Anton Chekhov, letter to A. S. Lazarev (1889) (\"Chekhov's gun\"); Robert McKee, Story (1997), ch. 10 \"Setups and Payoffs\"",
  check({ snapshot, chapters, book, options }) {
    const end = bookEnd(snapshot, chapters);
    const finished = isFinished({ options, book }, end);
    const staleAfter = numberOption(options, "staleAfter", DEFAULT_STALE_AFTER);
    const grace = numberOption(options, "grace", 0);
    const flagOpenEndings = options.flagOpenEndings === true;
    const findings: Diagnostic[] = [];

    for (const hook of snapshot.hooks.hooks) {
      if (!UNRESOLVED.has(hook.status)) continue;
      const start = hookStart(hook);
      if (start === null) continue;
      const last = lastTouched(snapshot, hook);
      const due = payoffChapter(hook);
      const overdue = due !== null ? end > due + grace : end - last >= staleAfter;
      const unpaid = finished && last < end;
      const openEnding = finished && last >= end;
      if (!overdue && !unpaid && !(openEnding && flagOpenEndings)) continue;
      const since = last > start ? `, last advanced in ch${last}` : "";
      const summary = due !== null && overdue
        ? `"${hookPromise(hook)}", opened in ch${start}, was due by ch${due} and is still ${hook.status} in ch${end}.`
        : finished
          ? `"${hookPromise(hook)}", opened in ch${start}${since}, is never resolved by the last chapter (ch${end}).`
          : `"${hookPromise(hook)}", opened in ch${start}${since}, has gone untouched for ${end - last} chapters.`;
      findings.push(structureFinding(this, {
        chapter: start,
        severity: overdue || (unpaid && end - last >= Math.min(staleAfter, 3)) ? "warning" : "note",
        summary,
        evidence: [renderHook(hook)],
      }));
    }

    if (options.items !== false) {
      const characters = characterNames(snapshot);
      for (const setup of trackedItems(snapshot, characters)) {
        if (setup.chapter >= end) continue;
        const returns = itemReturns(snapshot, setup, chapters, characters);
        if (returns.length > 0) continue;
        if (!finished && end - setup.chapter < staleAfter) continue;
        findings.push(structureFinding(this, {
          chapter: setup.chapter,
          severity: "note",
          summary: finished
            ? `The ${setup.item}, introduced in ch${setup.chapter}, never returns.`
            : `The ${setup.item}, introduced in ch${setup.chapter}, has not returned in ${end - setup.chapter} chapters.`,
          facts: [["introduced", setup.fact]],
          ...(chapters ? { chapters } : {}),
        }));
      }
    }
    return findings;
  },
};
