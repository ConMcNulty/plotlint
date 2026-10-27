import type { CurrentStateFact, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { ChapterTexts } from "../../evidence.js";
import { establishedAt } from "../../evidence.js";
import { segmentScenes } from "../../scenes.js";
import { hookStart, lastTouched } from "./common.js";
import { characterNames, factItems, factTerms, mentionsAny, sameTerm, textPhrases } from "./terms.js";

// The cut test's causal graph. Nodes are chapters and, when the chapter text is
// at hand and a chapter has several scenes, the scenes its facts' evidence
// passages fall in. An edge runs from an earlier node to a later one when the
// later one names something the earlier one established:
//   - a term (character, place, object) whose first fact is in the earlier node,
//     named again by a later fact, chapter summary or chapter text;
//   - an item whose possession the earlier node records, named again later;
//   - a hook the earlier node opens that a later chapter advances or resolves.
// A node nothing points out of is a cut candidate: nothing downstream needs it.

export interface DependencyNode {
  /** `ch3`, or `ch3.s2` for a scene. */
  readonly id: string;
  readonly chapter: number;
  /** 0-based scene index, for scene nodes. */
  readonly scene?: number;
  /** Facts recorded in the node (for a scene, those whose evidence is in it). */
  readonly facts: ReadonlyArray<CurrentStateFact>;
  /** Terms the node is the first to name. */
  readonly introduces: ReadonlyArray<string>;
  /** Hooks the node opens. */
  readonly hooks: ReadonlyArray<string>;
}

export interface DependencyEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "term" | "item" | "hook";
  /** The term, item or hook id the later node depends on. */
  readonly via: string;
  /** How the later node names it. */
  readonly through: "fact" | "summary" | "text" | "hook";
  readonly fact?: CurrentStateFact;
}

export interface DependencyGraph {
  readonly nodes: ReadonlyArray<DependencyNode>;
  readonly edges: ReadonlyArray<DependencyEdge>;
  /** Edges out of a node: what depends on it. */
  dependents(id: string): DependencyEdge[];
}

export interface DependencyGraphOptions {
  readonly chapters?: ChapterTexts;
  /** Add scene nodes for chapters with several scenes (needs `chapters`). Default true. */
  readonly scenes?: boolean;
}

/** A position in the book: chapter, then scene (-1 when the fact's scene is unknown). */
interface Position { readonly chapter: number; readonly scene: number }

const later = (a: Position, b: Position, sceneLevel: boolean) =>
  b.chapter > a.chapter || (sceneLevel && b.chapter === a.chapter && a.scene >= 0 && b.scene > a.scene);

/** Build the dependency graph between chapters (and scenes) from state and, when given, chapter text. */
export function dependencyGraph(snapshot: RuntimeStateSnapshot, options: DependencyGraphOptions = {}): DependencyGraph {
  const { chapters } = options;
  const characters = characterNames(snapshot);
  const facts = [...snapshot.currentState.facts].sort((a, b) => a.sourceChapter - b.sourceChapter);
  const scenesByChapter = new Map<number, { start: number; end: number }[]>();
  if (chapters && options.scenes !== false) {
    for (const [chapter, text] of chapters) scenesByChapter.set(chapter, segmentScenes(text, { chapter }));
  }
  const positionOf = (fact: CurrentStateFact): Position => {
    const scenes = scenesByChapter.get(fact.sourceChapter);
    if (!chapters || !scenes || scenes.length < 2) return { chapter: fact.sourceChapter, scene: -1 };
    const located = establishedAt(fact, chapters).location;
    if (!located) return { chapter: fact.sourceChapter, scene: -1 };
    return { chapter: fact.sourceChapter, scene: scenes.findIndex((s) => located.start >= s.start && located.start < s.end) };
  };
  const placed = facts.map((fact) => ({ fact, at: positionOf(fact), terms: factTerms(fact, characters), items: factItems(fact, characters) }));

  // Terms by first position.
  const firsts: Array<{ term: string; at: Position }> = [];
  for (const { terms, at } of placed) {
    for (const term of terms) {
      const known = firsts.find((first) => sameTerm(first.term, term));
      if (!known) firsts.push({ term, at });
      else if (known.at.chapter === at.chapter && known.at.scene < 0 && at.scene >= 0) firsts[firsts.indexOf(known)] = { term: known.term, at };
    }
  }

  const nodes: DependencyNode[] = [];
  const chapterNumbers = [...new Set([...facts.map((f) => f.sourceChapter), ...(chapters ? [...chapters.keys()] : [])])].sort((a, b) => a - b);
  for (const chapter of chapterNumbers) {
    const own = placed.filter((p) => p.at.chapter === chapter);
    nodes.push({
      id: `ch${chapter}`, chapter, facts: own.map((p) => p.fact),
      introduces: firsts.filter((f) => f.at.chapter === chapter).map((f) => f.term),
      hooks: snapshot.hooks.hooks.filter((h) => h.startChapter > 0 && hookStart(h) === chapter).map((h) => h.hookId),
    });
    const scenes = scenesByChapter.get(chapter) ?? [];
    if (scenes.length < 2) continue;
    scenes.forEach((_, index) => {
      const inScene = own.filter((p) => p.at.scene === index);
      if (inScene.length === 0) return;
      nodes.push({
        id: `ch${chapter}.s${index + 1}`, chapter, scene: index, facts: inScene.map((p) => p.fact),
        introduces: firsts.filter((f) => f.at.chapter === chapter && f.at.scene === index).map((f) => f.term),
        hooks: [],
      });
    });
  }

  // Text and summaries per later position, for mentions outside the facts.
  const sceneTexts: Array<{ at: Position; text: string; through: "text" | "summary" }> = [];
  for (const [chapter, text] of chapters ?? []) {
    const scenes = scenesByChapter.get(chapter) ?? [];
    if (scenes.length < 2) sceneTexts.push({ at: { chapter, scene: -1 }, text, through: "text" });
    else scenes.forEach((s, index) => sceneTexts.push({ at: { chapter, scene: index }, text: text.slice(s.start, s.end), through: "text" }));
  }
  for (const row of snapshot.chapterSummaries.rows) {
    sceneTexts.push({ at: { chapter: row.chapter, scene: -1 }, text: `${row.events}\n${row.stateChanges}`, through: "summary" });
  }

  const nodeId = (at: Position, sceneLevel: boolean) => (sceneLevel && at.scene >= 0 ? `ch${at.chapter}.s${at.scene + 1}` : `ch${at.chapter}`);
  const edges: DependencyEdge[] = [];
  const seen = new Set<string>();
  const add = (edge: DependencyEdge) => {
    const key = `${edge.from}>${edge.to}>${edge.kind}>${edge.via}`;
    if (edge.from === edge.to || seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };

  const follow = (kind: "term" | "item", via: string, from: Position, item: boolean) => {
    for (const sceneLevel of [false, true]) {
      if (sceneLevel && from.scene < 0) continue;
      const fromId = nodeId(from, sceneLevel);
      const phrases = textPhrases(via, item);
      for (const p of placed) {
        if (!later(from, p.at, sceneLevel)) continue;
        if (p.terms.some((term) => sameTerm(term, via)) || mentionsAny(`${p.fact.subject}\n${p.fact.object}`, phrases)) {
          add({ from: fromId, to: nodeId(p.at, sceneLevel), kind, via, through: "fact", fact: p.fact });
        }
      }
      for (const t of sceneTexts) {
        if (later(from, t.at, sceneLevel) && mentionsAny(t.text, phrases)) add({ from: fromId, to: nodeId(t.at, sceneLevel), kind, via, through: t.through });
      }
    }
  };

  for (const first of firsts) follow("term", first.term, first.at, false);
  for (const p of placed) for (const item of p.items) follow("item", item, p.at, true);
  for (const hook of snapshot.hooks.hooks) {
    const start = hookStart(hook);
    if (start === null || hook.startChapter === 0) continue;
    const last = lastTouched(snapshot, hook);
    if (last > start) add({ from: `ch${start}`, to: `ch${last}`, kind: "hook", via: hook.hookId, through: "hook" });
  }

  return { nodes, edges, dependents: (id) => edges.filter((edge) => edge.from === id) };
}
