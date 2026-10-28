import type { Diagnostic, DiagnosticSeverity } from "@plotlint/diagnostics";
import type { CompileMessage } from "@plotlint/rules";

/** One chat completion: the messages in, the model's text out. Same shape as `@plotlint/rules`' `CompleteFn`. */
export type Complete = (messages: ReadonlyArray<CompileMessage>) => Promise<string>;

/** `[start, end)` in UTF-16 units of the current draft. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** The chapter the loop is revising, as it stands this round. */
export interface Draft {
  readonly chapter: number;
  readonly text: string;
}

/**
 * The editor roles of the plan. Continuity runs L0–L3 findings from state; developmental
 * runs L4 and the pack's structural checks; line runs L1 and L2; the beta-reader panel
 * reports what readers would feel. Every editor only files findings; none writes prose.
 */
export type EditorRole = "continuity" | "developmental" | "line" | "beta";

export interface EditorInput {
  readonly draft: Draft;
  /** Round number, from 1 (0 is the check of the starting draft). */
  readonly round: number;
  /**
   * The parts of the draft that changed since the last round, or undefined for the
   * whole draft. An editor may limit itself to them; the loop keeps its earlier
   * ranged findings outside them.
   */
  readonly scope?: ReadonlyArray<Span>;
}

export interface Editor {
  readonly role: EditorRole;
  /** A name for logs ("line", "beta:skeptic"). */
  readonly name: string;
  /** True when the editor reads only `scope`, so the loop carries its findings outside it. */
  readonly incremental?: boolean;
  check(input: EditorInput): Promise<Diagnostic[]>;
}

/** A finding as the loop tracks it across rounds. */
export interface Finding {
  /** Short id the author agent answers to this round ("f3"). */
  readonly id: string;
  /** Stable across rounds while the finding is the same (see `findingKey`). */
  readonly key: string;
  readonly diagnostic: Diagnostic;
  /** Editors that filed it; several after the arbiter merges duplicates. */
  readonly editors: ReadonlyArray<string>;
  /** The flagged text, when the finding points into the draft. */
  readonly span?: Span;
}

/** A change the author agent proposes: replace the one occurrence of `find` with `replace`. */
export interface Edit {
  readonly find: string;
  readonly replace: string;
}

/** fix: change the text; defend: keep it, with a reason tied to intent; defer: log it for later. */
export type ResponseAction = "fix" | "defend" | "defer";

export interface AuthorResponse {
  readonly id: string;
  readonly action: ResponseAction;
  readonly reason: string;
  readonly edits: ReadonlyArray<Edit>;
}

export interface AuthorInput {
  readonly draft: Draft;
  readonly round: number;
  /** Open findings, ranked by the arbiter, each with the region the author may change for it. */
  readonly findings: ReadonlyArray<Finding & { readonly region?: Span }>;
  /** The author's chosen voice sample, so revisions keep the style. */
  readonly voiceSample: string;
}

export interface Author {
  readonly name: string;
  respond(input: AuthorInput): Promise<AuthorResponse[]>;
}

/** How far around a flagged span the author may edit. `chapter` lets it touch anything. */
export type EditScope = "span" | "sentence" | "paragraph" | "scene" | "chapter";

/** Weighted counts the stop conditions compare from round to round. */
export interface Score {
  readonly errors: number;
  readonly warnings: number;
  readonly notes: number;
  /** errors × 10 + warnings × 3 + notes. */
  readonly weighted: number;
}

export const SEVERITY_WEIGHT: Readonly<Record<DiagnosticSeverity, number>> = { error: 10, warning: 3, note: 1 };
