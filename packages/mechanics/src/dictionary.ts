import type { RuntimeStateSnapshot } from "@actalk/inkos-core";

// Latin-script words only: Harper is English-only, and CJK names would never be flagged anyway.
const WORD = /\p{Script=Latin}[\p{Script=Latin}\p{M}'’]*/gu;
const POSSESSIVE = /['’]s?$/u;
const CAPITALIZED = /^\p{Lu}/u;

/** Split free text into dictionary words, dropping possessives and single letters. */
export function dictionaryWords(text: string): string[] {
  return [...text.matchAll(WORD)]
    .map((match) => match[0].replace(POSSESSIVE, ""))
    .filter((word) => word.length > 1);
}

// Capitalized words that do not open a sentence, so "The" in "The key..." is not taken for a name.
function properNouns(text: string): string[] {
  const words: string[] = [];
  for (const match of text.matchAll(WORD)) {
    const before = text.slice(0, match.index).trimEnd();
    if (!CAPITALIZED.test(match[0]) || before === "" || /[.!?:"“]$/u.test(before)) continue;
    words.push(...dictionaryWords(match[0]));
  }
  return words;
}

/**
 * Names the story uses, from story state, so mechanics checks accept invented
 * character and place names. Fact subjects are entity names; objects and
 * summaries' character lists add names that only appear on the other side of a
 * fact; hook notes add capitalized mid-sentence words.
 */
export function projectDictionary(snapshot: RuntimeStateSnapshot): string[] {
  const words: string[] = [];
  for (const fact of snapshot.currentState.facts) {
    words.push(...dictionaryWords(fact.subject));
    words.push(...dictionaryWords(fact.object).filter((word) => CAPITALIZED.test(word)));
  }
  for (const row of snapshot.chapterSummaries.rows) words.push(...dictionaryWords(row.characters));
  for (const hook of snapshot.hooks.hooks) words.push(...properNouns(`${hook.notes}\n${hook.expectedPayoff}`));
  return [...new Set(words)].sort();
}
