import type { DiagnosticConfidence, DiagnosticLayer, DiagnosticSeverity } from "@plotlint/diagnostics";
import type { DiagnosticEntry } from "@plotlint/editor";
import type { LintDiagnostic } from "./lint-client";

/** One line of the problems panel: a drawn (ranged) finding or an unranged state finding. */
export interface ProblemRow {
  readonly key: string;
  readonly diagnostic: LintDiagnostic;
  /** The editor diagnostic id, for findings drawn in the text. */
  readonly entryId: string | null;
  /** Editor position of the finding, for ordering; null when it has no range. */
  readonly from: number | null;
  /** 1-based line in the chapter text, or null when it has no range. */
  readonly line: number | null;
  readonly stale: boolean;
}

export type ProblemSort = "position" | "severity" | "layer" | "confidence";

export interface ProblemFilter {
  readonly layer: DiagnosticLayer | "all";
  readonly severity: DiagnosticSeverity | "all";
  readonly confidence: DiagnosticConfidence | "all";
}

export const ALL_PROBLEMS: ProblemFilter = { layer: "all", severity: "all", confidence: "all" };

export const LAYER_ORDER: ReadonlyArray<DiagnosticLayer> = ["mechanics", "style", "metrics", "continuity", "structure", "judgment"];
export const SEVERITY_ORDER: ReadonlyArray<DiagnosticSeverity> = ["error", "warning", "note"];
export const CONFIDENCE_ORDER: ReadonlyArray<DiagnosticConfidence> = ["deterministic", "extracted", "judged"];

const rank = <T>(order: ReadonlyArray<T>, value: T) => {
  const index = order.indexOf(value);
  return index < 0 ? order.length : index;
};

export function problemRows(
  ranged: ReadonlyArray<DiagnosticEntry>,
  unranged: ReadonlyArray<LintDiagnostic>,
  lineOf: (pos: number) => number,
): ProblemRow[] {
  return [
    ...ranged.map((entry): ProblemRow => ({
      key: `r:${entry.id}`,
      diagnostic: entry.diagnostic as LintDiagnostic,
      entryId: entry.id,
      from: entry.from,
      line: lineOf(entry.from),
      stale: entry.stale,
    })),
    ...unranged.map((diagnostic, index): ProblemRow => ({
      key: `u:${diagnostic.fingerprint}:${index}`,
      diagnostic,
      entryId: null,
      from: null,
      line: null,
      stale: false,
    })),
  ];
}

/** Rows matching the filter, sorted; position order puts unranged (whole-chapter) findings first. */
export function visibleProblems(rows: ReadonlyArray<ProblemRow>, filter: ProblemFilter, sort: ProblemSort): ProblemRow[] {
  const byPosition = (a: ProblemRow, b: ProblemRow) => (a.from ?? -1) - (b.from ?? -1);
  const compare: Record<ProblemSort, (a: ProblemRow, b: ProblemRow) => number> = {
    position: byPosition,
    severity: (a, b) => rank(SEVERITY_ORDER, a.diagnostic.severity) - rank(SEVERITY_ORDER, b.diagnostic.severity) || byPosition(a, b),
    layer: (a, b) => rank(LAYER_ORDER, a.diagnostic.layer) - rank(LAYER_ORDER, b.diagnostic.layer) || byPosition(a, b),
    confidence: (a, b) => rank(CONFIDENCE_ORDER, a.diagnostic.confidence) - rank(CONFIDENCE_ORDER, b.diagnostic.confidence) || byPosition(a, b),
  };
  return rows
    .filter(({ diagnostic }) =>
      (filter.layer === "all" || diagnostic.layer === filter.layer)
      && (filter.severity === "all" || diagnostic.severity === filter.severity)
      && (filter.confidence === "all" || diagnostic.confidence === filter.confidence))
    .sort(compare[sort]);
}

/** How many rows fall in each value of a field, for the filter menus. */
export function countBy<K extends "layer" | "severity" | "confidence">(rows: ReadonlyArray<ProblemRow>, field: K): Map<LintDiagnostic[K], number> {
  const counts = new Map<LintDiagnostic[K], number>();
  for (const { diagnostic } of rows) counts.set(diagnostic[field], (counts.get(diagnostic[field]) ?? 0) + 1);
  return counts;
}
