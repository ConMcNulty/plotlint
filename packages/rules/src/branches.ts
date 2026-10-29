import { diffWordsWithSpace } from "diff";
import type { CurrentStateFact, HookRecord, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { ChapterTexts } from "./evidence.js";
import { normalize } from "./rules/facts.js";

// What-if branches (PLAN, "What-if branches"): a branch is a copy of the book, so
// every InkOS and plotlint tool works on it as on any book; this module says how
// two of them differ, in text and in world state. Browser-safe.

export interface ChapterChange {
  readonly chapter: number;
  readonly status: "changed" | "added" | "removed";
  readonly wordsAdded: number;
  readonly wordsRemoved: number;
}

export interface FactChange {
  readonly subject: string;
  readonly predicate: string;
  /** The value on the main line, or null when only the branch has it. */
  readonly main: string | null;
  /** The value on the branch, or null when only the main line has it. */
  readonly branch: string | null;
}

export interface HookChange {
  readonly id: string;
  readonly promise: string;
  readonly main: HookRecord["status"] | null;
  readonly branch: HookRecord["status"] | null;
}

export interface BranchDiff {
  readonly chapters: ChapterChange[];
  /** World state at the end of each line: facts still standing that differ. */
  readonly facts: FactChange[];
  readonly hooks: HookChange[];
}

const WORD = /[\p{L}\p{N}]+/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const size = (text: string) => (text.match(CJK)?.length ?? 0) + (text.replace(CJK, " ").match(WORD)?.length ?? 0);

export function chapterChanges(main: ChapterTexts, branch: ChapterTexts): ChapterChange[] {
  const numbers = [...new Set([...main.keys(), ...branch.keys()])].sort((a, b) => a - b);
  const out: ChapterChange[] = [];
  for (const chapter of numbers) {
    const a = main.get(chapter);
    const b = branch.get(chapter);
    if (a === b) continue;
    if (a === undefined) out.push({ chapter, status: "added", wordsAdded: size(b!), wordsRemoved: 0 });
    else if (b === undefined) out.push({ chapter, status: "removed", wordsAdded: 0, wordsRemoved: size(a) });
    else {
      let wordsAdded = 0;
      let wordsRemoved = 0;
      for (const part of diffWordsWithSpace(a, b)) {
        if (part.added) wordsAdded += size(part.value);
        else if (part.removed) wordsRemoved += size(part.value);
      }
      out.push({ chapter, status: "changed", wordsAdded, wordsRemoved });
    }
  }
  return out;
}

const standing = (snapshot: RuntimeStateSnapshot | undefined) =>
  (snapshot?.currentState.facts ?? []).filter((fact) => fact.validUntilChapter === null);
const keyOf = (fact: CurrentStateFact) => `${normalize(fact.subject)}\u0000${normalize(fact.predicate)}`;

/** Facts standing at the end of each line, grouped by subject and predicate, where the values differ. */
export function factChanges(main: RuntimeStateSnapshot | undefined, branch: RuntimeStateSnapshot | undefined): FactChange[] {
  const group = (facts: CurrentStateFact[]) => {
    const map = new Map<string, { subject: string; predicate: string; values: Set<string> }>();
    for (const fact of facts) {
      const entry = map.get(keyOf(fact)) ?? { subject: fact.subject, predicate: fact.predicate, values: new Set<string>() };
      entry.values.add(fact.object);
      map.set(keyOf(fact), entry);
    }
    return map;
  };
  const a = group(standing(main));
  const b = group(standing(branch));
  const out: FactChange[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const left = a.get(key);
    const right = b.get(key);
    const removed = [...(left?.values ?? [])].filter((value) => !right?.values.has(value));
    const added = [...(right?.values ?? [])].filter((value) => !left?.values.has(value));
    const { subject, predicate } = (left ?? right)!;
    // One value replaced by another reads as a change; anything else as removals and additions.
    if (removed.length === 1 && added.length === 1) out.push({ subject, predicate, main: removed[0]!, branch: added[0]! });
    else {
      for (const value of removed) out.push({ subject, predicate, main: value, branch: null });
      for (const value of added) out.push({ subject, predicate, main: null, branch: value });
    }
  }
  return out.sort((x, y) => x.subject.localeCompare(y.subject) || x.predicate.localeCompare(y.predicate));
}

export function hookChanges(main: RuntimeStateSnapshot | undefined, branch: RuntimeStateSnapshot | undefined): HookChange[] {
  const a = new Map((main?.hooks.hooks ?? []).map((hook) => [hook.hookId, hook]));
  const b = new Map((branch?.hooks.hooks ?? []).map((hook) => [hook.hookId, hook]));
  const out: HookChange[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const left = a.get(id);
    const right = b.get(id);
    if (left?.status === right?.status) continue;
    const promise = ((left ?? right)!.expectedPayoff.trim() || (left ?? right)!.notes.trim() || id).replace(/\s+/gu, " ");
    out.push({ id, promise, main: left?.status ?? null, branch: right?.status ?? null });
  }
  return out.sort((x, y) => x.id.localeCompare(y.id));
}

export function diffBranches(
  main: { readonly texts: ChapterTexts; readonly snapshot?: RuntimeStateSnapshot },
  branch: { readonly texts: ChapterTexts; readonly snapshot?: RuntimeStateSnapshot },
): BranchDiff {
  return {
    chapters: chapterChanges(main.texts, branch.texts),
    facts: factChanges(main.snapshot, branch.snapshot),
    hooks: hookChanges(main.snapshot, branch.snapshot),
  };
}
