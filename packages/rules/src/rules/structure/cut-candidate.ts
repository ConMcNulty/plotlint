import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../../types.js";
import { bookEnd, numberOption, structureFinding } from "./common.js";
import { dependencyGraph } from "./dependency-graph.js";

// The cut test: if nothing later depends on a chapter (or scene), it may be
// cut without loss. Built on `dependencyGraph`. Conservative on purpose: the
// last `protectLast` chapters (default 2) are never flagged, since nothing comes
// after them to depend on them; a node needs at least `minFacts` facts
// (default 1), so a chapter the settler recorded nothing for is not judged, and
// at least two later chapters with facts, so unsettled chapters are not read as
// "nothing depends on it"; and
// scene nodes are opt-in (option `scenes`, default false) and flagged only in a
// chapter that has dependents itself. Scene findings are off by default because
// the settler's facts are chapter-level free text: on the 13-chapter, 39-scene
// lessing-fen eval book only 2 of 13 scene flags were real (the later scenes
// did use what the flagged scene established, in words no fact repeats).

/** Up to this many of the node's facts are cited. */
const MAX_CITED = 3;

export const cutCandidate: Rule = {
  id: "structure/cut-candidate",
  layer: "structure",
  title: "Nothing depends on this chapter",
  rationale: "If no later event, object or piece of knowledge depends on a chapter or scene, the story would read the same without it. It may still earn its place (mood, character, theme), but it is the first candidate to cut or to tie in.",
  source: "Robert McKee, Story (1997), ch. 2 on cause and effect; Shawn Coyne, The Story Grid (2015), \"does the scene turn and does it matter\"",
  check({ snapshot, chapters, options }) {
    const end = bookEnd(snapshot, chapters);
    const protectLast = numberOption(options, "protectLast", 2);
    const minFacts = Math.max(1, numberOption(options, "minFacts", 1));
    const graph = dependencyGraph(snapshot, { ...(chapters ? { chapters } : {}), scenes: options.scenes === true });
    const findings: Diagnostic[] = [];
    const flaggedChapters = new Set<number>();
    // Silence downstream only means something when later chapters were settled:
    // at least two later chapters must have facts of their own.
    const factChapters = [...new Set(snapshot.currentState.facts.map((fact) => fact.sourceChapter))];
    const eligible = graph.nodes.filter((node) => node.chapter > 0 && node.chapter <= end - protectLast && node.facts.length >= minFacts
      && factChapters.filter((chapter) => chapter > node.chapter).length >= 2);

    for (const node of eligible.filter((n) => n.scene === undefined)) {
      if (graph.dependents(node.id).length > 0) continue;
      flaggedChapters.add(node.chapter);
      findings.push(structureFinding(this, {
        chapter: node.chapter, severity: "note",
        summary: `Nothing after ch${node.chapter} depends on what it establishes; it is a candidate to cut or to tie into later chapters.`,
        evidence: [`${node.facts.length} fact${node.facts.length === 1 ? "" : "s"} recorded in ch${node.chapter}; no later fact, summary, chapter text or hook names anything it introduces`],
        facts: node.facts.slice(0, MAX_CITED).map((fact) => ["established", fact] as const),
        ...(chapters ? { chapters } : {}),
      }));
    }
    for (const node of eligible.filter((n) => n.scene !== undefined)) {
      if (flaggedChapters.has(node.chapter) || graph.dependents(node.id).length > 0) continue;
      findings.push(structureFinding(this, {
        chapter: node.chapter, severity: "note",
        summary: `Nothing after scene ${node.id} depends on what it establishes; it is a candidate to cut or to tie into later scenes.`,
        evidence: [`${node.facts.length} fact${node.facts.length === 1 ? "" : "s"} established in ${node.id}; nothing later names anything it introduces`],
        facts: node.facts.slice(0, MAX_CITED).map((fact) => ["established", fact] as const),
        ...(chapters ? { chapters } : {}),
      }));
    }
    return findings;
  },
};
