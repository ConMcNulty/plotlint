import type { Diagnostic } from "@plotlint/diagnostics";
import type { EvidenceLocation } from "@plotlint/rules";
import { fetchJson } from "../../hooks/use-api";

/** A finding from the Studio lint route, with the fingerprint "mark as intentional" saves. */
export type LintDiagnostic = Diagnostic & {
  readonly fingerprint: string;
  /** For a finding with no range: where the first fact it cites was established. */
  readonly established?: EvidenceLocation;
};

/**
 * Findings only a whole-chapter lint produces: the L2 metrics measure the chapter
 * as a whole, so a re-lint of the edited paragraphs leaves them as they were.
 */
export const wholeChapterOnly = (diagnostic: Diagnostic) => diagnostic.layer === "metrics";

export interface LintRange {
  readonly start: number;
  readonly end: number;
}

export interface LintResponse {
  readonly sourceId: string;
  readonly diagnostics: LintDiagnostic[];
  /** Paragraph ranges that were re-linted, or null for the whole text. */
  readonly ranges: LintRange[] | null;
  readonly suppressed: number;
  readonly stateMissing: boolean;
}

export interface LintRequest {
  readonly text: string;
  readonly ranges?: ReadonlyArray<LintRange>;
}

export type LintFunction = (request: LintRequest) => Promise<LintResponse>;

export const chapterSourceId = (chapter: number) => `chapter:${chapter}`;

/** A lint function bound to one chapter, calling `POST /api/v1/plotlint/lint`. */
export function chapterLinter(bookId: string, chapter: number): LintFunction {
  return (request) => fetchJson<LintResponse>("/plotlint/lint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId, chapter, text: request.text, ...(request.ranges ? { ranges: request.ranges } : {}) }),
  });
}

/** Save "mark as intentional" for one finding (or, without a fingerprint, the whole rule for this book). */
export function suppressDiagnostic(bookId: string, diagnostic: LintDiagnostic, reason: string, wholeRule = false): Promise<unknown> {
  const quote = diagnostic.sourceRefs?.[0]?.quote ?? diagnostic.summary;
  return fetchJson("/plotlint/suppressions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bookId,
      ruleId: diagnostic.ruleId,
      reason,
      ...(wholeRule ? {} : { fingerprint: diagnostic.fingerprint, quote }),
      ...(diagnostic.chapter === undefined ? {} : { chapter: diagnostic.chapter }),
    }),
  });
}
