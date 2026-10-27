import type { CurrentStateFact, RuntimeStateSnapshot } from "@actalk/inkos-core";
import { normalize } from "../facts.js";
import { characterNames, cleanTerm, mentionsAny } from "../structure/terms.js";

// Characters as the genre rules follow them: a display name from the state, the
// phrases prose uses for them (the full name, and each capitalised name part of
// three letters or more, since a book calls "Elspeth Marrow" "Elspeth"), and
// whether a fact or text names them. Name parts match case-sensitively, so "Will"
// is not "will".

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "sir", "lady", "lord", "the", "captain", "inspector", "detective", "father", "mother", "aunt", "uncle", "van", "von", "de", "del", "der", "le", "la"]);

/** Phrases that name a person in prose: the name, and its distinctive parts. */
export function personPhrases(name: string): string[] {
  const clean = cleanTerm(name);
  const phrases = new Set([clean]);
  if (/\p{Script=Han}/u.test(clean)) return [...phrases];
  for (const part of clean.split(/[\s.]+/u)) if (part.length >= 3 && /^\p{Lu}/u.test(part) && !TITLES.has(part.toLowerCase())) phrases.add(part);
  return [...phrases];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Whether `text` names the person: the full name in any case, or a name part as written. */
export function namesPerson(text: string, name: string): boolean {
  const [full, ...parts] = personPhrases(name);
  if (full && mentionsAny(text, [full])) return true;
  return parts.some((part) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(part)}(?![\\p{L}\\p{N}])`, "u").test(text));
}

/** Whether two names are the same person: equal, or one a distinctive part of the other ("Elspeth" in "Elspeth Marrow"). */
export function samePerson(a: string, b: string): boolean {
  const [ca, cb] = [cleanTerm(a), cleanTerm(b)];
  if (normalize(ca) === normalize(cb)) return true;
  // One is a single name part of the other; "Anna Marrow" is not "Elspeth Marrow".
  const part = (whole: string, piece: string) => personPhrases(whole).slice(1).some((phrase) => normalize(phrase) === normalize(piece));
  return part(ca, cb) || part(cb, ca);
}

/** Character names from the state, as the state writes them (first spelling seen). */
export function characters(snapshot: RuntimeStateSnapshot): string[] {
  const keys = characterNames(snapshot);
  const display = new Map<string, string>();
  for (const fact of snapshot.currentState.facts) {
    const key = normalize(fact.subject);
    if (keys.has(key) && !display.has(key)) display.set(key, fact.subject.trim());
  }
  for (const row of snapshot.chapterSummaries.rows) {
    for (const raw of row.characters.split(/[,，、;；]/u)) {
      const name = cleanTerm(raw.replace(/\s*[（(][^)）]*[)）]\s*/gu, " "));
      if (name && !display.has(normalize(name))) display.set(normalize(name), name);
    }
  }
  return [...display.values()];
}

const PROPER_NAME = /\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+)*/gu;

/** Capitalised names written in a value ("in love with Ben Okafor" → "Ben Okafor"), or a CJK value whole. */
export function properNames(text: string): string[] {
  if (/\p{Script=Han}/u.test(text)) return [cleanTerm(text)].filter((name) => name.length >= 2 && name.length <= 6);
  return [...text.matchAll(PROPER_NAME)].map((match) => match[0]).filter((name) => name.length >= 3 && !TITLES.has(name.toLowerCase()));
}

/** Whether a fact's subject is one of the two people and its value names the other. */
export function between(fact: CurrentStateFact, a: string, b: string): boolean {
  return (samePerson(fact.subject, a) && namesPerson(fact.object, b)) || (samePerson(fact.subject, b) && namesPerson(fact.object, a));
}

/** Whether the fact is about the person: its subject, or its object names them. */
export const factNames = (fact: CurrentStateFact, name: string) => samePerson(fact.subject, name) || namesPerson(fact.object, name);

/** Whether a chapter's summary lists the person among its characters. */
export function summaryLists(snapshot: RuntimeStateSnapshot, chapter: number, name: string): boolean {
  return snapshot.chapterSummaries.rows.some((row) => row.chapter === chapter && namesPerson(row.characters, name));
}
