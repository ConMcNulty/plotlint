import type { Diagnostic } from "@plotlint/diagnostics";
import { dialogueSpans, proseParagraphs, sentences, words } from "@plotlint/metrics";
import { overlaps, type PlacedEdit } from "./spans.js";
import type { Finding, Span } from "./types.js";

// Gaming detectors. They look at what the author agent changed this round for signs
// that it is satisfying a check rather than improving the prose (PLAN, "Guarding
// against Goodhart"): swapping in thesaurus words for lexical diversity, varying
// sentence length by rote for rhythm, and inserting empty "setup" lines so a setup
// looks paid off. They are held out: the author agent never sees them, and they
// count against the held-out score that stops a gaming loop.

export const GAMING_RULE_IDS = ["loop/thesaurus-words", "loop/uniform-variation", "loop/empty-setup"] as const;

const COMMON = new Set([
  "the", "and", "that", "with", "from", "they", "them", "their", "there", "which", "would", "could", "should", "about", "after",
  "before", "again", "where", "while", "through", "between", "something", "nothing", "everything", "anything", "someone", "because",
  "another", "without", "himself", "herself", "themselves", "together", "against", "already", "around", "turned", "looked", "thought",
  "nothing", "though", "really", "little", "people", "moment", "behind", "toward", "towards", "outside", "inside", "across", "always",
]);

// Mention-only verbs: a line that only has a character notice, glance at or remember a thing.
const MENTION_ONLY = /\b(?:notic|glanc|remember|recall|caught sight|eyed|spotted|thought (?:of|about)|was aware|could see|saw that|felt the weight|gaze (?:fell|drifted)|looked at|still (?:there|lay|sat|hung)|lay (?:on|in|where)|sat (?:on|in) the)\w*/iu;

// Findings about setups and payoffs, which an empty mention can seem to answer.
const SETUP_RULES = /^structure\/(?:unpaid-setup|unearned-payoff|fair-play|open-questions|subplot-balance|central-relationship)$|^continuity\/item-from-nowhere$/u;

export interface GamingInput {
  readonly chapter: number;
  /** The draft before the round's edits. */
  readonly before: string;
  /** The draft after them. */
  readonly after: string;
  readonly edits: ReadonlyArray<PlacedEdit & { readonly findingId: string }>;
  /** Spans of `after` holding each edit's replacement, in the order of `edits`. */
  readonly changed: ReadonlyArray<Span>;
  readonly findings: ReadonlyArray<Finding>;
  /** Words the book already uses (its other chapters and this one before the loop), lowercased. */
  readonly vocabulary: ReadonlySet<string>;
}

const diagnostic = (ruleId: string, layer: Diagnostic["layer"], chapter: number, span: Span, summary: string, evidence: string[]): Diagnostic => ({
  ruleId,
  layer,
  severity: "warning",
  confidence: "deterministic",
  code: ruleId.split("/")[1]!,
  summary,
  evidence,
  chapter,
  range: { sourceId: `chapter:${chapter}`, start: span.start, end: span.end },
});

/** Inserted words the book never used before: long, not common, not names. Three or more, and at least a quarter of the new long words. */
export function thesaurusWords(input: GamingInput): Diagnostic[] {
  const inserted: Array<{ word: string; span: Span }> = [];
  let long = 0;
  for (const [index, edit] of input.edits.entries()) {
    const removed = new Set(words(edit.find).map((word) => word.norm));
    const at = input.changed[index]!;
    for (const word of words(edit.replace, at.start)) {
      if (word.norm.length < 7 || removed.has(word.norm) || COMMON.has(word.norm)) continue;
      // A capitalised word mid-sentence is a name, which the book may introduce.
      const raw = input.after.slice(word.start, word.end);
      if (/^\p{Lu}/u.test(raw) && word.start > 0 && !/[.!?"“]\s*$/u.test(input.after.slice(Math.max(0, word.start - 3), word.start))) continue;
      long += 1;
      if (!input.vocabulary.has(word.norm)) inserted.push({ word: raw, span: { start: word.start, end: word.end } });
    }
  }
  if (inserted.length < 3 || inserted.length < long / 4) return [];
  const span = { start: Math.min(...inserted.map((entry) => entry.span.start)), end: Math.max(...inserted.map((entry) => entry.span.end)) };
  return [diagnostic("loop/thesaurus-words", "style", input.chapter, span,
    `The revision brings in ${inserted.length} long words the book has never used`,
    [`new words: ${inserted.map((entry) => entry.word).join(", ")}`, `${inserted.length} of ${long} long inserted words are new to the book`])];
}

/** Runs of six or more sentences in the touched paragraphs whose lengths alternate long, short, long, short. */
function alternatingRuns(chapter: number, text: string, changed: ReadonlyArray<Span>): Diagnostic[] {
  const found: Diagnostic[] = [];
  const all = sentences(text);
  for (const paragraph of proseParagraphs(text)) {
    if (!changed.some((span) => overlaps(span, paragraph) || (span.start === span.end && span.start >= paragraph.start && span.start <= paragraph.end))) continue;
    const list = all.filter((sentence) => sentence.start >= paragraph.start && sentence.end <= paragraph.end);
    let run = 1, best = 1, bestEnd = 0;
    for (let index = 2; index < list.length; index += 1) {
      const d1 = list[index - 1]!.words - list[index - 2]!.words;
      const d2 = list[index]!.words - list[index - 1]!.words;
      // Each swing must be a real one (four words or more) and reverse the last.
      run = d1 * d2 < 0 && Math.abs(d1) >= 4 && Math.abs(d2) >= 4 ? (run === 1 ? 3 : run + 1) : 1;
      if (run > best) [best, bestEnd] = [run, index];
    }
    if (best < 6) continue;
    const first = list[bestEnd - best + 1]!, last = list[bestEnd]!;
    found.push(diagnostic("loop/uniform-variation", "metrics", chapter, { start: first.start, end: last.end },
      `Sentence lengths alternate long and short ${best} times in a row in an edited paragraph`,
      [`lengths: ${list.slice(bestEnd - best + 1, bestEnd + 1).map((sentence) => sentence.words).join(", ")} words`]));
  }
  return found;
}

/** Edited paragraphs whose sentence lengths now alternate long, short, long, short for six or more sentences. */
export function uniformVariation(input: GamingInput): Diagnostic[] {
  const found = alternatingRuns(input.chapter, input.after, input.changed);
  if (found.length === 0) return [];
  // Drop runs that were there before the round too: that is the author's rhythm, not the loop's.
  const old = new Set(alternatingRuns(input.chapter, input.before, [{ start: 0, end: input.before.length }]).map((entry) => entry.evidence[0]));
  return found.filter((entry) => !old.has(entry.evidence[0]));
}

/** A short inserted narrative sentence that only mentions a thing, added to answer a setup or payoff finding. */
export function emptySetup(input: GamingInput): Diagnostic[] {
  const byId = new Map(input.findings.map((finding) => [finding.id, finding]));
  const dialogue = dialogueSpans(input.after);
  const list = sentences(input.after, undefined, dialogue);
  const found: Diagnostic[] = [];
  for (const [index, edit] of input.edits.entries()) {
    const finding = byId.get(edit.findingId);
    if (!finding || !SETUP_RULES.test(finding.diagnostic.ruleId)) continue;
    const at = input.changed[index]!;
    const before = new Set(sentences(edit.find).map((sentence) => edit.find.slice(sentence.start, sentence.end).trim()));
    for (const sentence of list) {
      // Whole new sentences inside the replacement only.
      if (sentence.start < at.start || sentence.end > at.end || sentence.dialogue || sentence.words > 25) continue;
      const text = input.after.slice(sentence.start, sentence.end);
      if (before.has(text.trim()) || !MENTION_ONLY.test(text)) continue;
      found.push(diagnostic("loop/empty-setup", "structure", input.chapter, sentence,
        `An inserted line only mentions something, to answer ${finding.diagnostic.ruleId}`,
        [`inserted: "${text.trim()}"`, `for: ${finding.diagnostic.summary}`]));
    }
  }
  return found;
}

export function detectGaming(input: GamingInput): Diagnostic[] {
  if (input.edits.length === 0) return [];
  return [...thesaurusWords(input), ...uniformVariation(input), ...emptySetup(input)];
}

/** Lowercased words of the given texts, for `GamingInput.vocabulary`. */
export function vocabularyOf(texts: Iterable<string>): Set<string> {
  const vocabulary = new Set<string>();
  for (const text of texts) for (const word of words(text)) vocabulary.add(word.norm);
  return vocabulary;
}
