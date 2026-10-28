import type { Diagnostic, DiagnosticLayer } from "@plotlint/diagnostics";
import { findingKey, findingSpan } from "./spans.js";
import { SEVERITY_WEIGHT, type AuthorResponse, type Finding, type Score } from "./types.js";

// The arbiter is not a writer. It merges duplicate findings, settles conflicting
// notes (one editor wants more description, another less) by the pack's priority,
// ranks what is left (errors, then warnings, then notes), and judges the author's
// defences: accepted, escalated to the human gate, or not a defence at all.

const severityRank = { error: 0, warning: 1, note: 2 } as const;

/** Layers from most to least objective: the fallback priority when a pack names none. */
const LAYER_ORDER: ReadonlyArray<DiagnosticLayer> = ["continuity", "structure", "mechanics", "style", "metrics", "judgment"];

const globRegex = (glob: string) =>
  new RegExp(`^${glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join(".*")}$`, "u");

/** Rank of a finding by the pack's priority list (rule ids or globs, highest first), then by layer. */
export function priorityOf(diagnostic: Diagnostic, priority: ReadonlyArray<string>): number {
  const index = priority.findIndex((glob) => globRegex(glob).test(diagnostic.ruleId));
  return index >= 0 ? index : priority.length + LAYER_ORDER.indexOf(diagnostic.layer);
}

/** Which way a finding pushes the prose, for spotting editors that pull in opposite directions. */
export interface Direction {
  readonly axis: string;
  readonly sign: 1 | -1;
}

/**
 * The direction of a finding: metric findings by their rule and side of the band,
 * beta-reader notes by their `more:<axis>` or `less:<axis>` code.
 */
export function directionOf(diagnostic: Diagnostic): Direction | undefined {
  const code = diagnostic.code?.match(/^(more|less):([a-z-]+)$/u);
  if (code) return { axis: code[2]!, sign: code[1] === "more" ? 1 : -1 };
  const summary = diagnostic.summary.toLowerCase();
  switch (diagnostic.ruleId) {
    case "metrics/dialogue-ratio":
      return { axis: "dialogue", sign: /little|low|few/u.test(summary) ? 1 : -1 };
    case "metrics/sensory-detail":
      return { axis: "description", sign: 1 };
    case "metrics/wall-of-text":
      return { axis: "description", sign: -1 };
    default:
      return undefined;
  }
}

export interface ArbitrationLogEntry {
  readonly kind: "merged" | "conflict";
  readonly kept: string;
  readonly dropped: string;
  readonly reason: string;
}

export interface Arbitration {
  /** Ranked: errors, then warnings, then notes; ties by pack priority, then position. */
  readonly findings: Finding[];
  readonly log: ArbitrationLogEntry[];
}

const better = (a: Finding, b: Finding, priority: ReadonlyArray<string>) =>
  severityRank[a.diagnostic.severity] - severityRank[b.diagnostic.severity]
  || priorityOf(a.diagnostic, priority) - priorityOf(b.diagnostic, priority);

/**
 * Turn the editors' diagnostics into findings for one round. Duplicates (the same
 * key, or the same flagged span from different rules) merge into the stronger one;
 * of two findings pulling one axis in opposite directions the lower-priority one is
 * dropped; the rest are ranked.
 */
export function arbitrate(
  filed: ReadonlyArray<{ readonly editor: string; readonly diagnostic: Diagnostic }>,
  text: string,
  priority: ReadonlyArray<string> = [],
): Arbitration {
  const log: ArbitrationLogEntry[] = [];
  const byKey = new Map<string, { diagnostic: Diagnostic; editors: string[]; key: string; span?: { start: number; end: number } }>();
  for (const { editor, diagnostic } of filed) {
    const key = findingKey(diagnostic, text);
    const current = byKey.get(key);
    if (!current) {
      const span = findingSpan(diagnostic, text);
      byKey.set(key, { diagnostic, editors: [editor], key, ...(span ? { span } : {}) });
      continue;
    }
    if (!current.editors.includes(editor)) current.editors.push(editor);
    if (severityRank[diagnostic.severity] < severityRank[current.diagnostic.severity]) current.diagnostic = diagnostic;
  }

  let findings: Finding[] = [...byKey.values()].map((entry, index) => ({ id: `f${index + 1}`, ...entry }));
  // The same words flagged by two rules: one finding, the stronger rule's.
  const bySpan = new Map<string, Finding>();
  const merged: Finding[] = [];
  for (const finding of [...findings].sort((a, b) => better(a, b, priority))) {
    const spanKey = finding.span && finding.span.end > finding.span.start ? `${finding.span.start}:${finding.span.end}` : undefined;
    const kept = spanKey ? bySpan.get(spanKey) : undefined;
    if (!kept) {
      if (spanKey) bySpan.set(spanKey, finding);
      merged.push(finding);
      continue;
    }
    const index = merged.indexOf(kept);
    merged[index] = { ...kept, editors: [...new Set([...kept.editors, ...finding.editors])] };
    bySpan.set(spanKey!, merged[index]!);
    log.push({ kind: "merged", kept: kept.diagnostic.ruleId, dropped: finding.diagnostic.ruleId, reason: `both flag "${text.slice(finding.span!.start, finding.span!.end).slice(0, 60)}"` });
  }
  findings = merged;

  // Conflicting notes: keep the higher-priority side of each axis.
  const dropped = new Set<Finding>();
  for (const a of findings) {
    const da = directionOf(a.diagnostic);
    if (!da || dropped.has(a)) continue;
    for (const b of findings) {
      const db = directionOf(b.diagnostic);
      if (a === b || !db || dropped.has(b) || db.axis !== da.axis || db.sign === da.sign) continue;
      const [winner, loser] = better(a, b, priority) <= 0 ? [a, b] : [b, a];
      dropped.add(loser);
      log.push({ kind: "conflict", kept: winner.diagnostic.ruleId, dropped: loser.diagnostic.ruleId, reason: `opposite advice on ${da.axis}; ${winner.diagnostic.ruleId} has priority` });
      if (loser === a) break;
    }
  }

  const ranked = findings.filter((finding) => !dropped.has(finding)).sort((a, b) =>
    better(a, b, priority) || (a.span?.start ?? Infinity) - (b.span?.start ?? Infinity) || a.key.localeCompare(b.key));
  return { findings: ranked.map((finding, index) => ({ ...finding, id: `f${index + 1}` })), log };
}

export function score(diagnostics: ReadonlyArray<Diagnostic>): Score {
  let errors = 0, warnings = 0, notes = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errors += 1;
    else if (diagnostic.severity === "warning") warnings += 1;
    else notes += 1;
  }
  return { errors, warnings, notes, weighted: errors * SEVERITY_WEIGHT.error + warnings * SEVERITY_WEIGHT.warning + notes * SEVERITY_WEIGHT.note };
}

export type DefenceVerdict = "accepted" | "escalated" | "rejected";

export interface DefencePolicy {
  /** Most of a round's findings the author may defend or defer before the rest escalate. Default 0.5. */
  readonly maxDefendShare?: number;
}

// Reasons that say nothing about intent.
const EMPTY_REASON = /^(?:(?:it'?s |this is )?(?:fine|ok|okay|intentional|deliberate|correct|not an issue|style|stylistic|the author'?s (?:choice|style)|no change needed)\.?)$/iu;

/** A defence must give a reason of six or more words that is not a stock dismissal. */
export const substantive = (reason: string) => reason.trim().split(/\s+/u).length >= 6 && !EMPTY_REASON.test(reason.trim());

/**
 * Judge one defence. An empty one is no defence (the finding stays open). Errors from
 * code (deterministic, or checked over extracted facts) are never waved through by an
 * agent: they go to the human gate. A substantive defence of a warning or note is accepted.
 */
export function judgeDefence(finding: Finding, response: AuthorResponse): DefenceVerdict {
  if (!substantive(response.reason)) return "rejected";
  if (finding.diagnostic.severity === "error" && finding.diagnostic.confidence !== "judged") return "escalated";
  return "accepted";
}

/** Defer is for later work, not for errors: an error deferred stays open. */
export const deferAllowed = (finding: Finding) => finding.diagnostic.severity !== "error";
