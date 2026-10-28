import type { CurrentStateFact, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import { hasKind } from "../../predicates.js";
import type { Rule, RuleContext } from "../../types.js";
import { annotatedScenes } from "../scene-structure.js";
import { normalize } from "../facts.js";
import { bookEnd, isFinished, numberOption, structureFinding } from "../structure/common.js";
import { between, characters, factNames, namesPerson, properNames, samePerson, summaryLists } from "./people.js";

// Romance checks over story state: who the two leads are, how their relationship
// ends, and how much of the book it occupies; and, from scene annotations, whether
// both leads get a point of view.

/**
 * The two leads: option `leads` (two names) when set, else the pair of characters
 * with the most relationship facts with each other, at least `minFacts` (default 2)
 * of them, so a book with no clear couple yields none.
 */
export function romanceLeads(snapshot: RuntimeStateSnapshot, options: RuleContext["options"] = {}): [string, string] | null {
  const given = options.leads;
  if (Array.isArray(given) && given.length === 2 && given.every((name) => typeof name === "string" && name.trim())) {
    return [String(given[0]).trim(), String(given[1]).trim()];
  }
  const minFacts = Math.max(1, numberOption(options, "minFacts", 2));
  const names = characters(snapshot);
  const counts = new Map<string, { pair: [string, string]; count: number }>();
  for (const fact of snapshot.currentState.facts) {
    if (!aboutCouple(fact)) continue;
    const a = names.find((name) => samePerson(fact.subject, name));
    if (!a) continue;
    // The other side: a known character the value names, else the names written in it.
    const known = names.filter((name) => name !== a && namesPerson(fact.object, name));
    for (const b of known.length ? known : properNames(fact.object).filter((name) => !samePerson(name, a))) {
      const pair = [a, b].sort() as [string, string];
      const key = pair.map(normalize).join("|");
      counts.set(key, { pair, count: (counts.get(key)?.count ?? 0) + 1 });
    }
  }
  const ranked = [...counts.values()].sort((x, y) => y.count - x.count || x.pair.join().localeCompare(y.pair.join()));
  const best = ranked[0];
  if (!best || best.count < minFacts) return null;
  // A tie between two couples leaves the leads unknown.
  if (ranked[1] && ranked[1].count === best.count) return null;
  return best.pair;
}

const leadsLabel = ([a, b]: readonly [string, string]) => `${a} and ${b}`;

// What a relationship (or a lead's status) says about the couple. Negation first:
// "no longer loves" is an ending, not love.
const ENDED = /\b(no longer|not|never|ex|former(ly)?|broke(n)? up|break(s|ing)? up|split( up)?|separat(ed|es|ion)|divorc(ed|e|es)|estranged|left|leaves|walked out|abandon(ed|s)|betray(ed|s|al)|jilted|rejected|ended|is over|it'?s over|parted|apart|dead|died|dies|killed|murdered|griev(es|ing)|mourn(s|ing)?|hates?|hatred|despises|enem(y|ies)|distrusts?|heartbroken|cut off|goodbye|farewell)\b|n['’]t\b|分手|离婚|分开|决裂|离开|背叛|死|恨|仇/iu;
const TOGETHER = /\b(love[sd]?|in love|together|married|marry|marries|wed(ding|s)?|engaged|engagement|fianc[ée]e?|partners?|lovers?|couple|dating|courting|reunited|reconcil(ed|es|iation)|kiss(ed|es)?|committed|devoted|spouse|husband|wife|proposed|accepted|forgave|forgives|trusts?|hope(ful)?|happily|future)\b|相爱|恋人|结婚|订婚|在一起|和好|重逢|爱/iu;
const DEAD = /^(dead|deceased|died|killed|murdered|死亡|已死|身亡)$/iu;

type Tone = "ended" | "together" | "unclear";

/** Whether a relationship fact's predicate and value read as the couple together, ended, or neither. */
export function relationshipTone(fact: CurrentStateFact): Tone {
  const text = `${fact.predicate.replace(/[_-]+/gu, " ")} ${fact.object}`;
  if (ENDED.test(text)) return "ended";
  if (TOGETHER.test(text)) return "together";
  return "unclear";
}

/**
 * A fact about the couple: a relationship fact, or one whose predicate says what
 * happened between them ("broke up with", "married"), from one lead to the other.
 */
export function coupleFact(fact: CurrentStateFact, leads: readonly [string, string]): boolean {
  return between(fact, ...leads) && aboutCouple(fact);
}

const aboutCouple = (fact: CurrentStateFact) => {
  const predicate = fact.predicate.replace(/[_-]+/gu, " ");
  return hasKind(fact, "relationship") || ENDED.test(predicate) || TOGETHER.test(predicate);
};

const order = (a: CurrentStateFact, b: CurrentStateFact) => a.validFromChapter - b.validFromChapter || a.sourceChapter - b.sourceChapter;

export const hopefulEnding: Rule = {
  id: "structure/hopeful-ending",
  layer: "structure",
  title: "Romance ends unhappily",
  rationale: "Romance readers rely on the genre's promise: the central couple ends together, happily ever after or happy for now. A finished book whose last word on the leads is a break-up, a death or a parting breaks that promise; if the book is a tragedy or a love story rather than a romance, say so in its packs.",
  source: "Romance Writers of America's definition of the genre: \"a central love story and an emotionally satisfying and optimistic ending\" (HEA/HFN)",
  check({ snapshot, chapters, book, options }) {
    const end = bookEnd(snapshot, chapters);
    if (!isFinished({ options, book }, end)) return [];
    const leads = romanceLeads(snapshot, options);
    if (!leads) return [];
    const facts = snapshot.currentState.facts;
    const couple = facts.filter((fact) => coupleFact(fact, leads)).sort(order);
    // A lead who dies is the relationship's last word too.
    const deaths = facts.filter((fact) => hasKind(fact, "status") && DEAD.test(fact.object.trim()) && leads.some((lead) => samePerson(fact.subject, lead)));
    const events = [...couple, ...deaths].sort(order);
    const last = events[events.length - 1];
    if (!last) return [];
    // Facts from the same chapter as the last one: any hopeful one among them wins.
    const final = events.filter((fact) => fact.validFromChapter === last.validFromChapter);
    if (final.some((fact) => couple.includes(fact) && relationshipTone(fact) === "together")) return [];
    // An ending whose own validity ran out before the last chapter was itself undone.
    const stillTrue = (fact: CurrentStateFact) => fact.validUntilChapter === null || fact.validUntilChapter >= end;
    const ended = deaths.includes(last) || (relationshipTone(last) === "ended" && stillTrue(last));
    if (!ended) return [];
    return [structureFinding(this, {
      chapter: last.sourceChapter, severity: "warning",
      summary: deaths.includes(last)
        ? `The book ends with ${last.subject} dead (ch${last.sourceChapter}) and nothing after it for ${leadsLabel(leads)}; romance readers expect a happy or hopeful ending.`
        : `The last word on ${leadsLabel(leads)} is "${last.object}" (ch${last.sourceChapter}), with nothing hopeful after it; romance readers expect a happy or hopeful ending.`,
      evidence: [`leads: ${leadsLabel(leads)}${Array.isArray(options.leads) ? " (from the rule's options)" : " (the pair with the most relationship facts)"}`],
      facts: [["last relationship fact", last], ...couple.filter((fact) => fact !== last).slice(-2).map((fact) => ["earlier", fact] as const)],
      ...(chapters ? { chapters } : {}),
    })];
  },
};

/** The chapters in which the leads' relationship is on the page: a fact between them, or both appear. */
export function relationshipChapters(snapshot: RuntimeStateSnapshot, leads: readonly [string, string], chapters?: ReadonlyMap<number, string>): Set<number> {
  const on = new Set<number>();
  for (const fact of snapshot.currentState.facts) if (coupleFact(fact, leads)) on.add(fact.sourceChapter);
  const present = (chapter: number, lead: string) =>
    summaryLists(snapshot, chapter, lead)
    || snapshot.currentState.facts.some((fact) => fact.sourceChapter === chapter && factNames(fact, lead))
    || (chapters?.has(chapter) === true && namesPerson(chapters.get(chapter)!, lead));
  for (const chapter of bookChapters(snapshot, chapters)) if (leads.every((lead) => present(chapter, lead))) on.add(chapter);
  return on;
}

/** The book's chapters: those with text, else those with a summary or facts. */
function bookChapters(snapshot: RuntimeStateSnapshot, chapters?: ReadonlyMap<number, string>): number[] {
  const numbers = chapters?.size ? [...chapters.keys()]
    : [...snapshot.chapterSummaries.rows.map((row) => row.chapter), ...snapshot.currentState.facts.map((fact) => fact.sourceChapter)];
  return [...new Set(numbers.filter((n) => n > 0))].sort((a, b) => a - b);
}

export const centralRelationship: Rule = {
  id: "structure/central-relationship",
  layer: "structure",
  title: "The relationship is off the page",
  rationale: "In a romance the relationship is the main plot. When the leads share few chapters, and their relationship rarely changes on the page, the love story becomes a subplot; bring them together more often or let more turning points involve both.",
  source: "Romance Writers of America (\"the main plot centers around individuals falling in love\"); Gwen Hayes, Romancing the Beat (2016)",
  check({ snapshot, chapters, options }) {
    const leads = romanceLeads(snapshot, options);
    if (!leads) return [];
    const all = bookChapters(snapshot, chapters);
    const minChapters = Math.max(1, numberOption(options, "minChapters", 3));
    if (all.length < minChapters) return [];
    const minShare = numberOption(options, "minShare", 0.4);
    const on = relationshipChapters(snapshot, leads, chapters);
    const share = all.filter((chapter) => on.has(chapter)).length / all.length;
    if (share >= minShare) return [];
    const off = all.filter((chapter) => !on.has(chapter));
    return [structureFinding(this, {
      severity: "note",
      summary: `${leadsLabel(leads)} share only ${Math.round(share * 100)}% of the chapters (${all.length - off.length} of ${all.length}); in a romance their relationship is the main plot (floor ${Math.round(minShare * 100)}%).`,
      evidence: [
        `leads: ${leadsLabel(leads)}`,
        `chapters without both leads or a change between them: ${off.map((n) => `ch${n}`).join(", ")}`,
      ],
    })];
  },
};

export const bothLeadsPov: Rule = {
  id: "structure/both-leads-pov",
  layer: "structure",
  title: "One lead never has the point of view",
  rationale: "Most romance gives both leads a point of view, so the reader knows why each falls in love and what each risks. A lead who is only ever seen from outside can read as a prize rather than a person; give them scenes of their own, or interiority the other lead can't see.",
  source: "Dual-POV convention in contemporary romance (Gwen Hayes, Romancing the Beat, 2016; Jennifer Crusie on the hero's point of view)",
  check({ snapshot, book, options }) {
    const scenes = annotatedScenes(book).filter((scene) => scene.pov?.trim());
    if (scenes.length === 0) return [];
    const leads = romanceLeads(snapshot, options);
    if (!leads) return [];
    const findings: Diagnostic[] = [];
    for (const lead of leads) {
      if (scenes.some((scene) => samePerson(scene.pov!, lead))) continue;
      const povs = [...new Set(scenes.map((scene) => scene.pov!.trim()))];
      findings.push(structureFinding(this, {
        severity: "note",
        summary: `${lead} never has the point of view: none of the ${scenes.length} annotated scenes is theirs.`,
        evidence: [`leads: ${leadsLabel(leads)}`, `points of view in the scene annotations: ${povs.join(", ")}`],
      }));
    }
    return findings;
  },
};
