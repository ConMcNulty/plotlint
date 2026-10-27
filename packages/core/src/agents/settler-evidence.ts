// plotlint: turn the settler's quoted evidence into located spans.
import type { FactEvidence, FactKind, StateFactOps } from "../models/runtime-state.js";
import { locateQuote } from "../utils/quote-locate.js";

interface SubmittedFactOps {
  readonly upsert: ReadonlyArray<{ subject: string; predicate: string; object: string; kind?: FactKind; evidence?: string }>;
  readonly expire: ReadonlyArray<{ subject: string; predicate: string; object?: string; evidence?: string }>;
}

export interface UnresolvedFactEvidence {
  readonly path: string;
  readonly fact: string;
  /** The submitted quote, or absent when an upsert cited none. */
  readonly quote?: string;
}

export interface ResolvedSettlementFactOps {
  readonly factOps: StateFactOps;
  /** Upserts without a quote, and quotes that are not in the chapter (their ops keep the quote without offsets). */
  readonly unresolved: ReadonlyArray<UnresolvedFactEvidence>;
}

export function resolveFactEvidence(submitted: SubmittedFactOps, chapterText: string): ResolvedSettlementFactOps {
  const unresolved: UnresolvedFactEvidence[] = [];
  const locate = (quote: string | undefined, path: string, fact: string, required: boolean): FactEvidence | undefined => {
    const trimmed = quote?.trim();
    if (!trimmed) {
      if (required) unresolved.push({ path, fact });
      return undefined;
    }
    const span = locateQuote(chapterText, trimmed);
    if (!span) {
      unresolved.push({ path, fact, quote: trimmed.slice(0, 300) });
      return { quote: trimmed };
    }
    return { quote: chapterText.slice(span.start, span.end), start: span.start, end: span.end };
  };
  const render = (op: { subject: string; predicate: string; object?: string }) =>
    [op.subject, op.predicate, op.object].filter(Boolean).join(" · ");

  return {
    factOps: {
      upsert: submitted.upsert.map((op, index) => {
        const evidence = locate(op.evidence, `/factOps/upsert/${index}/evidence`, render(op), true);
        return {
          subject: op.subject,
          predicate: op.predicate,
          object: op.object,
          ...(op.kind ? { kind: op.kind } : {}),
          ...(evidence ? { evidence } : {}),
        };
      }),
      expire: submitted.expire.map((op, index) => {
        const evidence = locate(op.evidence, `/factOps/expire/${index}/evidence`, render(op), false);
        return {
          subject: op.subject,
          predicate: op.predicate,
          ...(op.object !== undefined ? { object: op.object } : {}),
          ...(evidence ? { evidence } : {}),
        };
      }),
    },
    unresolved,
  };
}

/** The error a settler sees when a quote is not in the chapter, so it can correct the quote and resubmit. */
export function unresolvedEvidenceError(unresolved: ReadonlyArray<UnresolvedFactEvidence>): Error {
  const details = {
    code: "SETTLER_EVIDENCE_NOT_FOUND",
    issues: unresolved.slice(0, 16),
    issueCount: unresolved.length,
    instruction: "Each evidence value must be copied verbatim from this chapter's body. Replace these quotes with exact passages from the chapter (or drop the fact op if the chapter does not establish it), keep every other op unchanged, and resubmit.",
  };
  return Object.assign(new Error(JSON.stringify(details)), details);
}
