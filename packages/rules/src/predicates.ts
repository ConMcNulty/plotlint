import type { CurrentStateFact, FactKind } from "@actalk/inkos-core";
import { normalize } from "./rules/facts.js";
import { STATUS_PREDICATES } from "./rules/dead-entity-acts.js";
import { LOCATION_PREDICATES } from "./rules/two-places-at-once.js";

// Typed predicates: the settler labels new facts with a kind; older facts are
// classified from their predicate name.

const AGE_PREDICATES = new Set(["age", "currentage", "年龄", "年纪", "岁数", "当前年龄"]);

/** The kind of state a predicate name records, or "other" when the name is not in the vocabulary. */
export function classifyPredicate(predicate: string): FactKind {
  const key = normalize(predicate);
  if (STATUS_PREDICATES.has(key)) return "status";
  if (LOCATION_PREDICATES.has(key)) return "location";
  if (AGE_PREDICATES.has(key)) return "age";
  return "other";
}

/** A fact's kind: the settler's label when it gave one, else classified from the predicate. */
export const factKind = (fact: CurrentStateFact): FactKind => fact.kind ?? classifyPredicate(fact.predicate);
