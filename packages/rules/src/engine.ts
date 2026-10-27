import { applyRuntimeStateDelta, type RuntimeStateDelta, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import { DiagnosticSchema, sortDiagnostics, type Diagnostic } from "@plotlint/diagnostics";
import type { BookRuleData } from "./book.js";
import type { ChapterTexts } from "./evidence.js";
import { downgradeUnreliable, frameResolver, mainTimeline } from "./frames.js";
import { RuleRegistry, type ConfiguredRule } from "./registry.js";
import type { Rule } from "./types.js";
import { deadEntityActs } from "./rules/dead-entity-acts.js";
import { deadThenAlive } from "./rules/dead-then-alive.js";
import { invariantRule } from "./rules/invariant.js";
import { itemTwoHolders } from "./rules/item-two-holders.js";
import { negativeResource } from "./rules/negative-resource.js";
import { singleValuedConflict } from "./rules/single-valued-conflict.js";
import { twoPlacesAtOnce } from "./rules/two-places-at-once.js";

export const builtinRules: ReadonlyArray<Rule> = [
  deadEntityActs, deadThenAlive, twoPlacesAtOnce, itemTwoHolders, negativeResource, singleValuedConflict,
  invariantRule,
];

/** The built-in rules by id. Hosts that add their own rules build a registry from `builtinRules`. */
export const builtinRegistry = new RuleRegistry(builtinRules);

export interface CheckOptions {
  /** The rules to run; the built-in registry by default. */
  readonly rules?: ReadonlyArray<Rule> | RuleRegistry;
  /** Chapter text by number: needed for scene frames and by rules that read prose. */
  readonly chapters?: ChapterTexts;
  /** The book's plotlint files: rule config, frames and rule data. */
  readonly book?: BookRuleData;
}

const asOptions = (value: ReadonlyArray<Rule> | CheckOptions | undefined): CheckOptions =>
  value === undefined ? {} : Array.isArray(value) ? { rules: value as ReadonlyArray<Rule> } : value as CheckOptions;

function configured(options: CheckOptions): ConfiguredRule[] {
  const registry = options.rules instanceof RuleRegistry ? options.rules
    : options.rules ? new RuleRegistry(options.rules)
    : builtinRegistry;
  return registry.configure(options.book?.config).filter((entry) => entry.enabled);
}

function run(
  snapshot: RuntimeStateSnapshot,
  extra: { previous?: RuntimeStateSnapshot; delta?: RuntimeStateDelta },
  options: CheckOptions,
): Diagnostic[] {
  const frames = frameResolver(options.book?.frames, options.chapters);
  const main = mainTimeline(snapshot, frames);
  const previous = extra.previous && mainTimeline(extra.previous, frames);
  const diagnostics = configured(options).flatMap(({ rule, severity, options: ruleOptions }) => {
    const found = rule.check({
      snapshot: main,
      ...(previous ? { previous } : {}),
      ...(extra.delta ? { delta: extra.delta } : {}),
      ...(options.chapters ? { chapters: options.chapters } : {}),
      ...(options.book ? { book: options.book } : {}),
      options: ruleOptions,
    });
    // Judged findings stay notes whatever the config says.
    return severity ? found.map((d) => (d.confidence === "judged" ? d : { ...d, severity })) : found;
  });
  // A rule that emits a malformed finding is a bug in the rule; fail loudly.
  return sortDiagnostics(downgradeUnreliable(diagnostics, main, frames).map((diagnostic) => DiagnosticSchema.parse(diagnostic)));
}

/** Check a persisted snapshot, e.g. a whole book's current state. */
export function checkSnapshot(
  snapshot: RuntimeStateSnapshot,
  options?: ReadonlyArray<Rule> | CheckOptions,
): Diagnostic[] {
  return run(snapshot, {}, asOptions(options));
}

/**
 * Check a settler delta before it is committed: apply it with InkOS's reducer,
 * run the rules over the proposed state and keep only findings in the delta's chapter.
 */
export function checkDelta(
  previous: RuntimeStateSnapshot,
  delta: RuntimeStateDelta,
  options?: ReadonlyArray<Rule> | CheckOptions,
): { next: RuntimeStateSnapshot; diagnostics: Diagnostic[] } {
  const next = applyRuntimeStateDelta({ snapshot: previous, delta });
  const diagnostics = run(next, { previous, delta }, asOptions(options))
    .filter((diagnostic) => diagnostic.chapter === delta.chapter);
  return { next, diagnostics };
}
