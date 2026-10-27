import type { RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { ChapterTexts } from "../../evidence.js";
import { textDiagnostic } from "../../text.js";
import type { Rule } from "../../types.js";
import { numberOption } from "../structure/common.js";

// Invented names and terms keep one spelling. Over every chapter, capitalised
// Latin-script words (hyphens and apostrophes inside a word kept, a trailing
// possessive dropped) are counted by spelling. A spelling is a term when it is
// used at least `minCount` times (default 4), almost always capitalised (the
// lowercase word is at most a tenth of its uses, so "Order"/"order" is not one),
// at least once mid-sentence. A rare spelling (at most `maxRare` uses, default 2,
// and at most a quarter of the term's) that is capitalised mid-sentence, never
// written in lowercase, is flagged when it
//   - is the term with a hyphen, apostrophe or internal capital added or dropped
//     ("Mist-born" for "Mistborn"), or
//   - is one edit away (Damerau: a letter added, dropped, changed or two swapped)
//     for terms of five letters or more, two edits for nine or more ("Sedia" for "Sedai").
// Plurals and possessives of the term, and spellings the story state names as
// entities of their own (two characters may be called Mara and Maya), are left alone.
// Each rare use is ranged, with a quick fix to the term's spelling. Deterministic:
// it reads only the text, and the state only to excuse names.

const WORD = /\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’-]\p{Script=Latin}[\p{Script=Latin}\p{M}]*)*/gu;
const POSSESSIVE = /['’]s?$/u;
// What opens a sentence before a word: the start, end punctuation, a quote or a dash.
const OPENER = /(^|[.!?:;"“”‘'’—–(\[*#_]|\n)\s*$/u;
// "Mr. Darcy": the full stop of a title does not end a sentence.
const TITLE_STOP = /(?<![\p{L}])(Mr|Mrs|Ms|Dr|St|Mt|Jr|Sr|Prof|Capt|Col|Gen|Lt|Sgt|Rev)\.\s*$/u;

interface Use {
  readonly chapter: number;
  readonly start: number;
  readonly end: number;
  readonly initial: boolean;
}

interface Spelling {
  readonly form: string;
  readonly uses: Use[];
}

const fold = (form: string) => form.toLowerCase().replace(/['’-]/gu, "");

/** Damerau-Levenshtein (optimal string alignment) distance, stopping early above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = value;
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
  }
  return rows[a.length]![b.length]!;
}

/** Every word use in the chapters, by spelling, and lowercase-word counts by folded form. */
function collect(chapters: ChapterTexts): { spellings: Map<string, Spelling>; lowercase: Map<string, number> } {
  const spellings = new Map<string, Spelling>();
  const lowercase = new Map<string, number>();
  for (const [chapter, text] of [...chapters].sort(([a], [b]) => a - b)) {
    for (const match of text.matchAll(WORD)) {
      const form = match[0].replace(POSSESSIVE, "");
      if (form.length < 2) continue;
      if (!/^\p{Lu}/u.test(form)) {
        lowercase.set(fold(form), (lowercase.get(fold(form)) ?? 0) + 1);
        continue;
      }
      // A heading line ("# Chapter 3: The Ledger") is not prose.
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      if (text[lineStart] === "#") continue;
      const before = text.slice(Math.max(0, match.index - 40), match.index);
      const initial = OPENER.test(before) && !TITLE_STOP.test(before);
      const entry = spellings.get(form) ?? { form, uses: [] };
      entry.uses.push({ chapter, start: match.index, end: match.index + form.length, initial });
      spellings.set(form, entry);
    }
  }
  return { spellings, lowercase };
}

/** Names the story state records, folded: fact subjects and capitalised words in values and summaries' character lists. */
function stateNames(snapshot: RuntimeStateSnapshot): Set<string> {
  const names = new Set<string>();
  const add = (text: string, capitalisedOnly: boolean) => {
    for (const match of text.matchAll(WORD)) {
      const word = match[0].replace(POSSESSIVE, "");
      if (!capitalisedOnly || /^\p{Lu}/u.test(word)) names.add(fold(word));
    }
  };
  for (const fact of snapshot.currentState?.facts ?? []) {
    add(fact.subject, false);
    add(fact.object, true);
  }
  for (const row of snapshot.chapterSummaries?.rows ?? []) add(row.characters, false);
  return names;
}

const inflection = (rare: string, term: string) => {
  const [r, t] = [fold(rare), fold(term)];
  return r === `${t}s` || r === `${t}es` || t === `${r}s` || t === `${r}es`;
};

/** Whether `rare` reads as a misspelling of `term`. */
export function nearSpelling(rare: string, term: string): boolean {
  if (rare === term || inflection(rare, term)) return false;
  if (fold(rare) === fold(term)) return true;
  const [r, t] = [rare.toLowerCase(), term.toLowerCase()];
  const length = Math.min(r.length, t.length);
  if (length < 5) return false;
  return editDistance(r, t, 2) <= (length >= 9 ? 2 : 1);
}

export const inventedTermSpelling: Rule = {
  id: "style/invented-term-spelling",
  layer: "style",
  title: "Invented term spelt two ways",
  rationale: "Invented names and terms have no dictionary to keep them straight, so a variant spelling slips past spellcheck and makes the reader wonder whether it is a different person, place or thing. Keep one spelling, as a series bible or style sheet would.",
  source: "Copyediting practice: the style sheet of names and invented terms (The Chicago Manual of Style, 17th ed., 2.54); fantasy editors' series bibles",
  check({ snapshot, chapters, options }) {
    if (!chapters?.size) return [];
    const minCount = Math.max(2, numberOption(options, "minCount", 4));
    const maxRare = Math.max(1, numberOption(options, "maxRare", 2));
    const { spellings, lowercase } = collect(chapters);
    const known = stateNames(snapshot);
    const lower = (form: string) => lowercase.get(fold(form)) ?? 0;
    const terms = [...spellings.values()].filter((spelling) => spelling.uses.length >= minCount
      && lower(spelling.form) * 10 <= spelling.uses.length
      && spelling.uses.some((use) => !use.initial));
    const findings: Diagnostic[] = [];
    for (const rare of spellings.values()) {
      const count = rare.uses.length;
      if (count > maxRare || lower(rare.form) > 0 || !rare.uses.some((use) => !use.initial)) continue;
      if (known.has(fold(rare.form)) && !terms.some((term) => fold(term.form) === fold(rare.form))) continue;
      const matches = terms.filter((term) => term.uses.length >= 4 * count && nearSpelling(rare.form, term.form));
      // Close to two different terms: no telling which was meant.
      if (matches.length !== 1) continue;
      const term = matches[0]!;
      for (const use of rare.uses) {
        const text = chapters.get(use.chapter)!;
        findings.push(textDiagnostic({
          rule: this,
          document: { sourceId: `chapter:${use.chapter}`, chapter: use.chapter, text },
          start: use.start, end: use.end, severity: "warning",
          summary: `"${rare.form}" looks like a variant of "${term.form}", which the book uses ${term.uses.length} times.`,
          evidence: [`"${term.form}": ${term.uses.length} uses, first in ch${term.uses[0]!.chapter}; "${rare.form}": ${count} use${count === 1 ? "" : "s"}`],
          fixes: [{ title: `Change to "${term.form}"`, replacement: term.form }],
        }));
      }
    }
    return findings;
  },
};
