import type { VerdictAction } from "@plotlint/diagnostics/verdicts";
import { fetchJson } from "../../hooks/use-api";
import type { LintDiagnostic } from "./lint-client";

/** A verdict to log: the finding and what the writer did with it. */
export interface VerdictEvent {
  readonly diagnostic: LintDiagnostic;
  readonly action: VerdictAction;
  /** How many findings share the diagnostic's fingerprint, when the caller knows. */
  readonly findings?: number;
}

const ACCEPTING: ReadonlySet<VerdictAction> = new Set(["fix", "edited"]);

/** The request body for `POST /api/v1/plotlint/verdicts`; the server stamps the time. */
export function verdictBody(bookId: string, events: ReadonlyArray<VerdictEvent>) {
  return {
    bookId,
    verdicts: events.map(({ diagnostic, action, findings }) => ({
      ruleId: diagnostic.ruleId,
      fingerprint: diagnostic.fingerprint,
      ...(diagnostic.chapter === undefined ? {} : { chapter: diagnostic.chapter }),
      verdict: ACCEPTING.has(action) ? "accepted" : "rejected",
      action,
      quote: (diagnostic.sourceRefs?.[0]?.quote ?? diagnostic.summary).slice(0, 500),
      layer: diagnostic.layer,
      confidence: diagnostic.confidence,
      ...(findings ? { findings } : {}),
    })),
  };
}

/**
 * Log verdicts for the writer study. Best effort: a failed log is reported in
 * the console and never gets in the writer's way.
 */
export function recordVerdicts(bookId: string, events: ReadonlyArray<VerdictEvent>): Promise<void> {
  if (events.length === 0) return Promise.resolve();
  return fetchJson("/plotlint/verdicts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(verdictBody(bookId, events)),
  }).then(() => undefined, (error: unknown) => {
    console.warn("plotlint: could not record verdict", error);
  });
}
