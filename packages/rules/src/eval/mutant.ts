import type { CurrentStateFact, FactKind, HookRecord } from "@actalk/inkos-core";
import type { BookRuleData } from "../book.js";
import type { ChapterTexts } from "../evidence.js";
import { SceneAnnotationSchema, type SceneAnnotation, type SceneAnnotationInput } from "../scene-annotations.js";

// Seeded-error evaluation (PLAN.md "Evaluation"): take a clean book, inject one
// known error at a time (a mutant) and measure whether the rule meant to catch it
// fires in the right chapter, and what else fires. A mutant changes both the prose
// and the facts, so the same mutant can be judged by the rules (over facts) and
// by the LLM-only auditor (over prose).

/** A clean book: chapter text, the oracle facts an ideal settler would write, and per-book rule data. */
export interface CleanBook {
  readonly name: string;
  readonly chapters: ChapterTexts;
  readonly facts: ReadonlyArray<CurrentStateFact>;
  /** Oracle hooks, in InkOS's hook-ledger shape; empty when the corpus has no `hooks.json`. */
  readonly hooks: ReadonlyArray<HookRecord>;
  /** The corpus's `story/plotlint/` files and `book.json` plan, read as a book's are. */
  readonly book: BookRuleData;
}

/** Replace `find` (which must occur exactly once in the chapter) with `replace`. */
export interface TextEdit {
  readonly chapter: number;
  readonly find: string;
  readonly replace: string;
}

export interface Mutant {
  /** `<rule name>/<n>`, stable so cached auditor responses stay valid. */
  readonly id: string;
  readonly ruleId: string;
  /** The chapter in which the seeded error should be reported. */
  readonly chapter: number;
  readonly description: string;
  readonly chapters: ChapterTexts;
  readonly facts: ReadonlyArray<CurrentStateFact>;
  readonly hooks: ReadonlyArray<HookRecord>;
  /** Extra book data for this mutant (e.g. changed scene annotations), over the mutator's `book` data. */
  readonly book?: Partial<BookRuleData>;
  /**
   * "book" for an error the rule reports about the whole book, with no chapter
   * (protagonist agency, a lead with no POV): any new finding of the rule catches it.
   */
  readonly scope?: "chapter" | "book";
  /**
   * How to tell that an auditor issue is about the seeded error: every group must
   * have one word (case-insensitive substring) in the issue's summary or evidence.
   */
  readonly match: ReadonlyArray<ReadonlyArray<string>>;
}

export interface Mutator {
  /** The rule that should catch these mutants; the harness skips the mutator when it is not registered. */
  readonly ruleId: string;
  readonly description: string;
  /** The corpus book the mutants are seeded into; "wenlow" when absent. */
  readonly corpus?: string;
  /**
   * Book data the rule needs, applied to the clean run and every mutant (e.g. a
   * travel graph or the author's invariants), so false alarms are measured with it too.
   */
  book?(clean: CleanBook): Partial<BookRuleData>;
  mutants(clean: CleanBook): Mutant[];
}

export interface FactSpec {
  readonly kind?: FactKind;
  readonly until?: number | null;
  /** Evidence quote; must be verbatim in the mutated chapter. */
  readonly quote?: string;
}

/** A fact as the settler would write it, recorded in its first chapter. */
export function fact(subject: string, predicate: string, object: string, from: number, spec: FactSpec = {}): CurrentStateFact {
  return {
    subject, predicate, object,
    validFromChapter: from,
    validUntilChapter: spec.until ?? null,
    sourceChapter: from,
    ...(spec.kind ? { kind: spec.kind } : {}),
    ...(spec.quote ? { evidence: { quote: spec.quote } } : {}),
  };
}

/** Insert `sentence` after `anchor`, a passage that occurs once in the chapter. */
export const insertAfter = (chapter: number, anchor: string, sentence: string): TextEdit =>
  ({ chapter, find: anchor, replace: `${anchor} ${sentence}` });

/** Rewrite a passage that occurs once in the chapter. */
export const rewrite = (chapter: number, find: string, replace: string): TextEdit => ({ chapter, find, replace });

/** Rewrite a whole clean chapter (for edits all through it, such as a name taken out); put it before other edits to the chapter. */
export function transform(clean: CleanBook, chapter: number, change: (text: string) => string): TextEdit {
  const text = clean.chapters.get(chapter);
  if (text === undefined) throw new Error(`no chapter ${chapter} in ${clean.name}`);
  return { chapter, find: text, replace: change(text) };
}

const sameFact = (a: CurrentStateFact, b: Pick<CurrentStateFact, "subject" | "predicate" | "object" | "validFromChapter">) =>
  a.subject === b.subject && a.predicate === b.predicate && a.object === b.object && a.validFromChapter === b.validFromChapter;

export interface FactChange {
  /** The clean fact to change, by subject, predicate, object and first chapter. */
  readonly target: Pick<CurrentStateFact, "subject" | "predicate" | "object" | "validFromChapter">;
  /** Fields to overwrite; `null` removes the fact. */
  readonly set: Partial<CurrentStateFact> | null;
}

export interface HookChange {
  /** The clean hook's id. */
  readonly target: string;
  /** Fields to overwrite; `null` removes the hook. */
  readonly set: Partial<HookRecord> | null;
}

export interface SceneChange {
  /** The clean scene annotation's id (`ch2.s1`). */
  readonly target: string;
  /** Fields to overwrite; `null` removes the annotation. */
  readonly set: Partial<SceneAnnotationInput> | null;
}

export interface MutantSpec {
  readonly chapter: number;
  readonly description: string;
  readonly edits?: ReadonlyArray<TextEdit>;
  readonly add?: ReadonlyArray<CurrentStateFact>;
  readonly change?: ReadonlyArray<FactChange>;
  readonly addHooks?: ReadonlyArray<HookRecord>;
  readonly changeHooks?: ReadonlyArray<HookChange>;
  /** Changes to the clean book's scene annotations (`scenes.json`). */
  readonly changeScenes?: ReadonlyArray<SceneChange>;
  readonly addScenes?: ReadonlyArray<SceneAnnotationInput>;
  readonly book?: Partial<BookRuleData>;
  readonly scope?: "chapter" | "book";
  readonly match: ReadonlyArray<ReadonlyArray<string>>;
}

/** A hook as InkOS's ledger records it (type "mystery" unless `extra` says otherwise). */
export function hook(hookId: string, startChapter: number, lastAdvancedChapter: number, status: HookRecord["status"], expectedPayoff: string, extra: Partial<HookRecord> = {}): HookRecord {
  return { hookId, startChapter, type: "mystery", status, lastAdvancedChapter, expectedPayoff, notes: "", ...extra };
}

/**
 * Apply a mutant spec to the clean book. Throws when an edit's passage is not
 * found exactly once or a change names no clean fact, so a corpus edit that
 * breaks a mutator fails the tests instead of silently weakening the eval.
 */
export function buildMutant(clean: CleanBook, ruleId: string, index: number, spec: MutantSpec): Mutant {
  const id = `${ruleId.split("/").pop()}/${index + 1}`;
  const chapters = new Map(clean.chapters);
  for (const edit of spec.edits ?? []) {
    const text = chapters.get(edit.chapter);
    if (text === undefined) throw new Error(`${id}: no chapter ${edit.chapter}`);
    const at = text.indexOf(edit.find);
    if (at < 0 || text.indexOf(edit.find, at + 1) >= 0) throw new Error(`${id}: passage not found exactly once in ch${edit.chapter}: ${edit.find}`);
    chapters.set(edit.chapter, text.slice(0, at) + edit.replace + text.slice(at + edit.find.length));
  }
  let facts = [...clean.facts];
  for (const change of spec.change ?? []) {
    const at = facts.findIndex((f) => sameFact(f, change.target));
    if (at < 0) throw new Error(`${id}: no clean fact ${JSON.stringify(change.target)}`);
    facts = change.set === null ? facts.filter((_, i) => i !== at) : facts.map((f, i) => (i === at ? { ...f, ...change.set } : f));
  }
  facts.push(...(spec.add ?? []));
  let hooks = [...clean.hooks];
  for (const change of spec.changeHooks ?? []) {
    const at = hooks.findIndex((h) => h.hookId === change.target);
    if (at < 0) throw new Error(`${id}: no clean hook ${change.target}`);
    hooks = change.set === null ? hooks.filter((_, i) => i !== at) : hooks.map((h, i) => (i === at ? { ...h, ...change.set } : h));
  }
  hooks.push(...(spec.addHooks ?? []));
  let book = spec.book;
  if (spec.changeScenes?.length || spec.addScenes?.length) {
    const file = clean.book.scenes;
    if (!file) throw new Error(`${id}: the clean book has no scenes.json`);
    let scenes: SceneAnnotation[] = [...file.scenes];
    for (const change of spec.changeScenes ?? []) {
      const at = scenes.findIndex((scene) => scene.id === change.target);
      if (at < 0) throw new Error(`${id}: no clean scene annotation ${change.target}`);
      scenes = change.set === null ? scenes.filter((_, i) => i !== at)
        : scenes.map((scene, i) => (i === at ? SceneAnnotationSchema.parse({ ...scene, ...change.set }) : scene));
    }
    scenes.push(...(spec.addScenes ?? []).map((scene) => SceneAnnotationSchema.parse(scene)));
    book = { ...book, scenes: { ...file, ...book?.scenes, scenes } };
  }
  return {
    id, ruleId, chapter: spec.chapter, description: spec.description, chapters, facts, hooks, match: spec.match,
    ...(book ? { book } : {}),
    ...(spec.scope ? { scope: spec.scope } : {}),
  };
}

/** A mutator from a list of specs. */
export function mutator(ruleId: string, description: string, specs: (clean: CleanBook) => MutantSpec[], book?: Mutator["book"], corpus?: string): Mutator {
  return {
    ruleId, description,
    ...(book ? { book } : {}),
    ...(corpus ? { corpus } : {}),
    mutants: (clean) => specs(clean).map((spec, index) => buildMutant(clean, ruleId, index, spec)),
  };
}
