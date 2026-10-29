import type { ChapterTexts } from "./evidence.js";
import { normalize } from "./rules/facts.js";

// Find all references (PLAN, "IDE-style navigation"): every appearance of an
// entity in the chapter text, grouped by chapter. An entity is found by the names
// the prose uses for it: its name in the story state, and each word of that name
// that no other entity shares ("Harrow" for "Aurel Harrow", unless the state also
// knows a "Mara Harrow"). Matches are whole words, ignoring case, longest name
// first, so "Aurel Harrow" counts once and not again as "Harrow". Browser-safe.

export interface ReferenceHit {
  readonly start: number;
  readonly end: number;
  /** The text as written ("Harrow's" matches as "Harrow"). */
  readonly text: string;
  /** 1-based line in the chapter file. */
  readonly line: number;
  /** The line around the hit, trimmed to about 120 characters. */
  readonly context: string;
}

export interface ReferenceGroup {
  readonly chapter: number;
  readonly hits: ReferenceHit[];
}

export interface References {
  /** The entity the name resolved to in the state, or the name itself when the state does not know it. */
  readonly entity: string;
  /** The names searched for, longest first. */
  readonly names: string[];
  readonly groups: ReferenceGroup[];
  readonly total: number;
}

// Honorifics and articles that start names without telling them apart.
const TITLES = new Set([
  "the", "a", "an", "of", "mr", "mrs", "ms", "miss", "dr", "sir", "lady", "lord", "captain", "king", "queen", "prince", "princess",
  "father", "mother", "aunt", "uncle", "old", "young", "saint", "st", "de", "van", "von", "la", "le",
]);

const words = (name: string) => name.split(/[\s\-‐–]+/u).map((word) => word.replace(/[^\p{L}\p{M}\p{N}'’]/gu, "")).filter(Boolean);

/**
 * The entity a name means and the names the prose may call it by. A name the state
 * spells exactly is that entity; a name inside exactly one subject's name ("Harrow"
 * in "Aurel Harrow") is that subject; otherwise the name stands for itself.
 */
export function referenceNames(subjects: ReadonlyArray<string>, name: string): { entity: string; names: string[] } {
  const unique = [...new Map(subjects.filter((subject) => subject.trim()).map((subject) => [normalize(subject), subject.trim()])).values()];
  const wanted = words(name).map((word) => word.toLowerCase());
  const exact = unique.find((subject) => normalize(subject) === normalize(name));
  const containing = unique.filter((subject) => {
    const own = words(subject).map((word) => word.toLowerCase());
    return wanted.length > 0 && own.length > wanted.length && wanted.every((word) => own.includes(word));
  });
  const entity = exact ?? (containing.length === 1 ? containing[0]! : name.trim());
  const others = unique.filter((subject) => normalize(subject) !== normalize(entity));
  const shared = new Set(others.flatMap((subject) => words(subject).map((word) => word.toLowerCase())));
  const names = new Set<string>([entity]);
  if (name.trim()) names.add(name.trim());
  const parts = words(entity);
  if (parts.length > 1) {
    for (const part of parts) {
      const key = part.toLowerCase();
      // A short word or a title would match too much; a word another entity has would match the wrong one.
      if (part.length >= 3 && /^\p{Lu}/u.test(part) && !TITLES.has(key) && !shared.has(key)) names.add(part);
    }
  }
  return { entity, names: [...names].sort((a, b) => b.length - a.length || a.localeCompare(b)) };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function contextOf(text: string, start: number, end: number): { line: number; context: string } {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  const lineEnd = newline < 0 ? text.length : newline;
  let from = lineStart;
  let to = lineEnd;
  if (to - from > 120) {
    from = Math.max(lineStart, start - 50);
    to = Math.min(lineEnd, end + 50);
  }
  const context = `${from > lineStart ? "…" : ""}${text.slice(from, to).trim()}${to < lineEnd ? "…" : ""}`;
  let line = 1;
  for (let i = text.indexOf("\n"); i >= 0 && i < start; i = text.indexOf("\n", i + 1)) line += 1;
  return { line, context };
}

/** Every whole-word appearance of any of `names` in the chapters, grouped by chapter in order. */
export function findReferences(chapters: ChapterTexts, names: ReadonlyArray<string>): ReferenceGroup[] {
  const sorted = [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!sorted.length) return [];
  // CJK text has no spaces between words, so a CJK name matches anywhere.
  const pattern = sorted.map((name) => CJK.test(name) ? escape(name) : `(?<![\\p{L}\\p{M}\\p{N}])${escape(name)}(?![\\p{L}\\p{M}\\p{N}])`).join("|");
  const regex = new RegExp(pattern, "giu");
  const groups: ReferenceGroup[] = [];
  for (const chapter of [...chapters.keys()].sort((a, b) => a - b)) {
    const text = chapters.get(chapter)!;
    const hits: ReferenceHit[] = [];
    for (const match of text.matchAll(regex)) {
      const start = match.index;
      const end = start + match[0].length;
      hits.push({ start, end, text: match[0], ...contextOf(text, start, end) });
    }
    if (hits.length) groups.push({ chapter, hits });
  }
  return groups;
}

/** References to the entity `name` means, over the state's subjects and the chapter text. */
export function referencesOf(subjects: ReadonlyArray<string>, name: string, chapters: ChapterTexts): References {
  const { entity, names } = referenceNames(subjects, name);
  const groups = findReferences(chapters, names);
  return { entity, names, groups, total: groups.reduce((sum, group) => sum + group.hits.length, 0) };
}
