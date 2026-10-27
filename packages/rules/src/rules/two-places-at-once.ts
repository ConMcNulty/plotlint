import type { CurrentStateFact } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../types.js";
import { factFinding, forEachOverlappingPair, groupBy, nested, normalize, normalizeValue } from "./facts.js";

// Predicates that put the subject somewhere. InkOS supersedes a fact when the
// same subject and predicate are upserted, so a live conflict usually comes from
// two spellings of "location" ("location" and "位置") that both stay valid.
// Words that also name a state or a role are left out: "in"/"is in" ("in love"),
// "at", "position" (a job), "place" (a ranking), "在" and "处于" ("处于昏迷").
export const LOCATION_PREDICATES = new Set([
  "location", "currentlocation", "whereabouts", "currentplace", "locatedat", "locatedin", "staysat", "stayingat",
  "位置", "当前位置", "所在", "所在地", "所在位置", "所在地点", "地点", "当前地点", "当前所在", "位于", "身处", "现处",
]);

// Values that do not name one place, so they cannot contradict another.
const VAGUE_PLACE = /^(unknown|none|nowhere|missing|travel(l)?ing|onthemove|ontheroad|enroute|intransit|未知|不明|下落不明|失踪|无|路上|途中|旅途中|赶路中|在路上)$|between|之间|附近|near|outside|外/u;

export const isLocationFact = (fact: CurrentStateFact) => LOCATION_PREDICATES.has(normalize(fact.predicate));

export const twoPlacesAtOnce: Rule = {
  id: "continuity/two-places-at-once",
  layer: "continuity",
  rationale: "A character can be in only one place at a time. Two location facts valid in the same chapter usually mean a move was recorded without ending the old location.",
  check({ snapshot }) {
    const located = snapshot.currentState.facts.filter((fact) =>
      isLocationFact(fact) && !VAGUE_PLACE.test(normalizeValue(fact.object)) && normalizeValue(fact.object) !== "");
    const diagnostics: Diagnostic[] = [];

    for (const facts of groupBy(located, (fact) => normalize(fact.subject)).values()) {
      forEachOverlappingPair(facts, (a, b, chapter) => {
        // A place nested in another ("harbour" and "the harbour docks") is not a contradiction.
        if (nested(normalizeValue(a.object), normalizeValue(b.object))) return;
        diagnostics.push(factFinding(this, {
          chapter,
          summary: `${a.subject} is recorded in two places in chapter ${chapter}: ${a.object} and ${b.object}.`,
          evidence: [["location", a], ["location", b]],
        }));
      });
    }
    return diagnostics;
  },
};
