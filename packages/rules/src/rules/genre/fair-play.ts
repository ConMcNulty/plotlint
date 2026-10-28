import type { CurrentStateFact, HookRecord, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { ChapterTexts } from "../../evidence.js";
import { hasKind } from "../../predicates.js";
import type { Rule } from "../../types.js";
import { normalize } from "../facts.js";
import { bookEnd, numberOption, renderHook, structureFinding } from "../structure/common.js";
import { characterNames, cleanTerm, factItems, factTerms, isTermLike, mentionsAny, sameTerm, textPhrases } from "../structure/terms.js";
import { namesPerson, samePerson } from "./people.js";

// Fair play in a mystery. The solution is found in the story state: facts whose
// predicate or value names a culprit or a hidden identity ("is the killer",
// "murdered", "true identity"), first recorded in chapter R, the reveal chapter;
// when a resolved mystery hook (type mystery, or a payoff that names a killer,
// culprit or solution) ends in a chapter with such facts, that chapter is R.
// Two things are checked:
//   (a) the culprit is on the page early: named in a fact, a summary's character
//       list or the chapter text by `culpritBy` — a fraction of the book (default
//       1/3) or, when 1 or more, a number of chapters before R;
//   (b) the solution rests on something shown before R: an earlier fact that
//       names the culprit together with another thing the reveal rests on (the
//       victim, a weapon, a place), or names one of the objects the solution
//       turns on (items held or used in the reveal chapter's facts about it), or
//       an earlier paragraph that names the culprit with one of those objects.
// Both are warnings with extracted confidence: they read the settler's facts.

const REVEAL_PREDICATE = new Set([
  "iskiller", "killer", "murderer", "ismurderer", "culprit", "isculprit", "perpetrator", "guiltyof", "responsiblefor",
  "murdered", "killed", "poisoned", "stabbed", "strangled", "shot", "framed", "committed",
  "murderedby", "killedby", "poisonedby", "stabbedby", "strangledby", "shotby",
  "trueidentity", "secretidentity", "realidentity", "realname", "truename", "isreally", "actuallyis",
  "凶手", "是凶手", "杀害", "谋杀", "毒害", "真实身份", "真名", "真正身份",
]);
// "X · murdered by · Y": the culprit is the value.
const CULPRIT_IN_OBJECT = new Set(["murderedby", "killedby", "poisonedby", "stabbedby", "strangledby", "shotby"]);
const IDENTITY = new Set(["trueidentity", "secretidentity", "realidentity", "realname", "truename", "isreally", "actuallyis", "真实身份", "真名", "真正身份"]);
const CULPRIT_VALUE = /\b(the\s+)?(killer|murderer|culprit|poisoner|perpetrator)\b|凶手/iu;
const SOLUTION_HOOK = /\b(killer|murderer|culprit|whodunit|who (killed|murdered|poisoned|did it)|solution|solved?|the murder)\b|凶手|真相/iu;

/** Whether a fact states part of a mystery's solution. */
export function isRevealFact(fact: CurrentStateFact): boolean {
  return REVEAL_PREDICATE.has(normalize(fact.predicate)) || CULPRIT_VALUE.test(fact.predicate.replace(/[_-]+/gu, " ")) || CULPRIT_VALUE.test(fact.object);
}

// Not a name: the state has not identified anyone yet.
const VAGUE = /^(unknown|someone|somebody|no one|nobody|an? (unknown|unidentified|mysterious)\b.*|unidentified\b.*|(the )?(stranger|assailant|attacker|intruder|figure)$|未知|某人|神秘人|不明)/iu;

/** The people a reveal fact unmasks: the killer, or both sides of a hidden identity. Vague values ("unknown assailant") name no one. */
function culpritsOf(fact: CurrentStateFact): string[] {
  const predicate = normalize(fact.predicate);
  const named = (raw: string) => (isTermLike(raw) && !VAGUE.test(raw.trim()) && !VAGUE.test(cleanTerm(raw)) ? [cleanTerm(raw)] : []);
  if (CULPRIT_IN_OBJECT.has(predicate)) return named(fact.object);
  if (IDENTITY.has(predicate)) return [...named(fact.subject), ...named(fact.object)];
  return named(fact.subject);
}

const isSolutionHook = (hook: HookRecord) =>
  hook.status === "resolved" && hook.lastAdvancedChapter > 0
  && (/mystery|whodunit|crime|murder|悬疑|推理|谜/iu.test(hook.type) || SOLUTION_HOOK.test(`${hook.expectedPayoff}\n${hook.notes}`));

export interface MysterySolution {
  /** The reveal chapter. */
  readonly chapter: number;
  readonly reveals: ReadonlyArray<CurrentStateFact>;
  readonly culprits: ReadonlyArray<string>;
  readonly hook?: HookRecord;
}

/**
 * The book's solution: the reveal facts of the chapter where they first appear,
 * or of the latest resolved mystery hook's chapter when that chapter has some.
 * Null when the state records no reveal.
 */
export function mysterySolution(snapshot: RuntimeStateSnapshot): MysterySolution | null {
  const reveals = snapshot.currentState.facts.filter((fact) => isRevealFact(fact) && culpritsOf(fact).length > 0);
  if (reveals.length === 0) return null;
  const hooks = snapshot.hooks.hooks.filter(isSolutionHook).sort((a, b) => b.lastAdvancedChapter - a.lastAdvancedChapter);
  const hook = hooks.find((candidate) => reveals.some((fact) => fact.sourceChapter === candidate.lastAdvancedChapter));
  const chapter = hook?.lastAdvancedChapter ?? Math.min(...reveals.map((fact) => fact.sourceChapter));
  const at = reveals.filter((fact) => fact.sourceChapter === chapter);
  const culprits: string[] = [];
  for (const name of at.flatMap(culpritsOf)) if (name && !culprits.some((known) => samePerson(known, name))) culprits.push(name);
  return { chapter, reveals: at, culprits, ...(hook ? { hook } : {}) };
}

/** The first chapter that names the person: a fact, a summary's character list, or the chapter text. */
function firstNamed(snapshot: RuntimeStateSnapshot, name: string, chapters?: ChapterTexts): number | null {
  const found: number[] = [];
  for (const fact of snapshot.currentState.facts) {
    if (samePerson(fact.subject, name) || namesPerson(fact.object, name)) found.push(fact.sourceChapter);
  }
  for (const row of snapshot.chapterSummaries.rows) if (namesPerson(row.characters, name) || namesPerson(row.events, name)) found.push(row.chapter);
  for (const [chapter, text] of chapters ?? []) if (namesPerson(text, name)) found.push(chapter);
  const positive = found.filter((chapter) => chapter > 0);
  return positive.length ? Math.min(...positive) : null;
}

const PREPOSITION = /^(of|to|with|by|for|from|against|on)\s+/iu;

/** Terms without repeats: the first of terms naming the same thing ("Lord Pym", "Pym") is kept. */
const dedupe = (terms: ReadonlyArray<string>) =>
  terms.reduce<string[]>((kept, term) => (kept.some((other) => sameTerm(other, term)) ? kept : [...kept, term]), []);

const paragraphs =(text: string) => text.replace(/\r\n?/gu, "\n").split(/\n\s*\n/u);

export const fairPlay: Rule = {
  id: "structure/fair-play",
  layer: "structure",
  hookOverlay: true,
  title: "Solution not fairly clued",
  rationale: "A fair-play mystery lets the reader solve it: the culprit is on stage early, and the solution rests on clues shown before the reveal. A culprit who first appears late, or a solution built on facts the reveal chapter introduces, reads as a cheat.",
  source: "Ronald Knox, \"Decalogue\" (1929), rule 1 (\"the criminal must be someone mentioned in the early part of the story\"); S. S. Van Dine, \"Twenty Rules for Writing Detective Stories\" (1928), rules 1 and 15",
  check({ snapshot, chapters, options }) {
    const solution = mysterySolution(snapshot);
    if (!solution) return [];
    const { chapter: reveal, reveals, culprits } = solution;
    const end = bookEnd(snapshot, chapters);
    const by = numberOption(options, "culpritBy", 1 / 3);
    const deadline = by >= 1 ? reveal - Math.round(by) : Math.max(1, Math.ceil(end * by));
    const cite = reveals.map((fact) => ["reveal", fact] as const);
    const hookLine = solution.hook ? [renderHook(solution.hook)] : [];
    const findings: Diagnostic[] = [];

    // (a) The culprit is on stage early.
    for (const culprit of culprits) {
      const first = firstNamed(snapshot, culprit, chapters);
      if (first !== null && first <= deadline && first < reveal) continue;
      const when = first === null || first >= reveal ? `first appears in the reveal chapter (ch${reveal})` : `first appears in ch${first}`;
      findings.push(structureFinding(this, {
        chapter: first !== null && first < reveal ? first : reveal, severity: "warning",
        summary: `The culprit, ${culprit}, ${when}; fair play wants the culprit on the page by ch${Math.max(1, deadline)}${by >= 1 ? ` (${Math.round(by)} chapters before the reveal)` : ""}.`,
        evidence: [`reveal in ch${reveal}`, ...hookLine],
        facts: cite,
        ...(chapters ? { chapters } : {}),
      }));
    }

    // (b) What the reveal rests on was shown before it.
    const names = characterNames(snapshot);
    const isCulprit = (term: string) => culprits.some((culprit) => samePerson(term, culprit));
    const mentionsCulprit = (fact: CurrentStateFact) => culprits.some((culprit) => samePerson(fact.subject, culprit) || namesPerson(fact.object, culprit));
    // Objects a fact is about: its possession items, and a subject that is a thing
    // ("silver letter-opener · used to kill · Lord Pym"). Resource-like names count here.
    const thingsOf = (fact: CurrentStateFact) => {
      const items = factItems(fact, names).map(cleanTerm);
      const subject = cleanTerm(fact.subject);
      if (/^\p{Ll}/u.test(subject) && !names.has(normalize(subject)) && /\p{L}{3}/u.test(subject)) items.push(subject);
      const object = cleanTerm(fact.object);
      if (items.length === 0 && hasKind(fact, "possession") && /\p{L}{3}/u.test(object) && object.split(/\s+/u).length <= 6) items.push(object);
      return items;
    };
    const termsOf = (fact: CurrentStateFact) => [...new Set([...factTerms(fact, names), ...thingsOf(fact)].map((term) => term.replace(PREPOSITION, "")))];
    const revealTerms = reveals.flatMap(termsOf);
    // The facts recorded with the reveal that share a term with it: the solution's working.
    const support = snapshot.currentState.facts.filter((fact) => fact.sourceChapter === reveal
      && (reveals.includes(fact) || termsOf(fact).some((term) => revealTerms.some((other) => sameTerm(term, other)))));
    const evidenceTerms = dedupe(support.flatMap(termsOf).filter((term) => !isCulprit(term)));
    // The objects the solution turns on (a weapon, a letter), which are clues wherever they appear.
    const things = dedupe(support.flatMap(thingsOf).filter((term) => !isCulprit(term)));
    const shares = (fact: CurrentStateFact, terms: ReadonlyArray<string>) => termsOf(fact).some((term) => terms.some((other) => sameTerm(term, other)));
    const earlier = snapshot.currentState.facts.filter((fact) => fact.sourceChapter > 0 && fact.sourceChapter < reveal);
    const clueFact = earlier.find((fact) => (mentionsCulprit(fact) && shares(fact, evidenceTerms)) || shares(fact, things));
    // In prose, the culprit seen with one of those objects; meeting the victim is no clue.
    const clueText = !clueFact && chapters && things.length > 0 ? [...chapters].find(([chapter, text]) => chapter > 0 && chapter < reveal
      && paragraphs(text).some((paragraph) => culprits.some((culprit) => namesPerson(paragraph, culprit)) && things.some((term) => mentionsAny(paragraph, textPhrases(term, true))))) : undefined;
    if (!clueFact && !clueText) {
      findings.push(structureFinding(this, {
        chapter: reveal, severity: "warning",
        summary: `The solution in ch${reveal} rests on information first given in the reveal chapter: nothing before it links ${culprits.join(" or ") || "the culprit"} to ${evidenceTerms.slice(0, 3).join(", ") || "the crime"}.`,
        evidence: [
          ...hookLine,
          `looked for: an earlier fact or paragraph naming ${culprits.join(" or ") || "the culprit"} with ${evidenceTerms.length ? evidenceTerms.join(", ") : "anything the reveal rests on"}`,
        ],
        facts: [...cite, ...support.filter((fact) => !reveals.includes(fact)).slice(0, 2).map((fact) => ["rests on", fact] as const)],
        ...(chapters ? { chapters } : {}),
      }));
    }
    return findings;
  },
};
