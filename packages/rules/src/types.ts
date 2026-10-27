import type { RuntimeStateDelta, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic, DiagnosticLayer, DiagnosticSeverity } from "@plotlint/diagnostics";
import type { BookRuleData } from "./book.js";
import type { ChapterTexts } from "./evidence.js";

export interface RuleContext {
  /**
   * The state the rule judges: the persisted snapshot, or the proposed next one when checking a delta.
   * Facts from flashback, dream and story-within-story scenes are already left out (see frames.ts).
   */
  readonly snapshot: RuntimeStateSnapshot;
  /** Present when checking a delta: the snapshot before it was applied, and the delta itself. */
  readonly previous?: RuntimeStateSnapshot;
  readonly delta?: RuntimeStateDelta;
  /** Chapter text by number, when the caller has it, for rules that read the prose. */
  readonly chapters?: ChapterTexts;
  /** The book's plotlint files (`story/plotlint/*.json`): rule config, frames and rule data. */
  readonly book?: BookRuleData;
  /** This rule's `options` from the book's rule config, or `{}`. */
  readonly options: Readonly<Record<string, unknown>>;
}

export interface Rule {
  /** `<layer>/<name>`, stable across releases so suppressions keep working. */
  readonly id: string;
  readonly layer: DiagnosticLayer;
  /** A few words naming what the rule checks, for rule lists ("Dead characters act"). */
  readonly title?: string;
  /** Why the rule matters, shown on hover. */
  readonly rationale: string;
  /** Where the craft advice behind the rule comes from: a URL or a citation. */
  readonly source?: string;
  check(context: RuleContext): Diagnostic[];
}

/** How a book's rule config sets one rule: off, a severity for all its findings, or a severity and options. */
export type RuleSetting = "off" | DiagnosticSeverity | { severity?: DiagnosticSeverity | "off"; options?: Record<string, unknown> };
