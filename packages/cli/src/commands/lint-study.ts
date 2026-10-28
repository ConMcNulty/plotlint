import type { Command } from "commander";
import { StateManager } from "@actalk/inkos-core";
import { DiagnosticLayerSchema, type Diagnostic, type DiagnosticConfidence, type DiagnosticLayer } from "@plotlint/diagnostics";
import { appendVerdicts, loadVerdicts, verdictsPath } from "@plotlint/diagnostics/node";
import {
  STUDY_MIN_VERDICTS,
  STUDY_REJECT_ABOVE,
  studyReport,
  VerdictActionSchema,
  verdictOfAction,
  verdictOn,
  verdictStats,
  type StudyDecision,
  type Verdict,
  type VerdictAction,
  type VerdictKind,
} from "@plotlint/diagnostics/verdicts";
import { adaptiveDecisions } from "@plotlint/rules";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";

/**
 * `inkos lint study` (the phase 4 writer-study report: accept and reject rates
 * per check, and which checks the gate turns off by default) and `inkos lint
 * verdict` (record a writer's verdict on one finding from the command line).
 * See docs/plotlint/WRITER-STUDY.md.
 */

/** A finding as `inkos lint --json` prints it. */
export type FingerprintedFinding = Diagnostic & { readonly fingerprint: string };

/** Every finding in a book, shown or suppressed, so a verdict can find the one a fingerprint names. */
export type FindingLister = (state: StateManager, bookId: string) => Promise<FingerprintedFinding[]>;

/** Parse `--min 20`: the pooled standing verdicts a check needs before the gate decides. */
export function parseMinVerdicts(value: string | undefined): number {
  if (value === undefined) return STUDY_MIN_VERDICTS;
  if (!/^\d+$/u.test(value.trim()) || Number(value) < 1) throw new Error(`--min takes a whole number of verdicts, 1 or more; got "${value}"`);
  return Number(value);
}

/** Parse `--reject-above 0.5`. */
export function parseRejectAbove(value: string | undefined): number {
  if (value === undefined) return STUDY_REJECT_ABOVE;
  const ratio = Number(value);
  if (!/^(?:\d+\.?\d*|\.\d+)$/u.test(value.trim()) || ratio >= 1) throw new Error(`--reject-above takes a ratio from 0 to below 1; got "${value}"`);
  return ratio;
}

/** `accept` or `reject` (also the past tenses) to a verdict. */
export function parseVerdictKind(value: string): VerdictKind {
  const kind = ({ accept: "accepted", accepted: "accepted", reject: "rejected", rejected: "rejected" } as const)[value.trim().toLowerCase() as "accept"];
  if (!kind) throw new Error(`verdict must be accept or reject; got "${value}"`);
  return kind;
}

/** `--action`, defaulting to `edited` for accept and `dismissed` for reject; it must agree with the verdict. */
export function parseVerdictAction(kind: VerdictKind, value: string | undefined): VerdictAction {
  if (value === undefined) return kind === "accepted" ? "edited" : "dismissed";
  const parsed = VerdictActionSchema.safeParse(value.trim());
  if (!parsed.success) throw new Error(`--action takes one of ${VerdictActionSchema.options.join(", ")}; got "${value}"`);
  if (verdictOfAction(parsed.data) !== kind) {
    throw new Error(`--action ${parsed.data} ${verdictOfAction(parsed.data) === "accepted" ? "accepts" : "rejects"} a finding; it cannot go with ${kind === "accepted" ? "accept" : "reject"}`);
  }
  return parsed.data;
}

const DEFAULT_CONFIDENCE: Record<DiagnosticLayer, DiagnosticConfidence> = {
  mechanics: "deterministic", style: "deterministic", metrics: "deterministic",
  continuity: "extracted", structure: "extracted", judgment: "judged",
};

/** The layer a rule id names (`<layer>/<name>`), for a verdict on a finding that is no longer in the book. */
export function layerOfRuleId(ruleId: string): DiagnosticLayer {
  const parsed = DiagnosticLayerSchema.safeParse(ruleId.split("/")[0]);
  if (!parsed.success) throw new Error(`"${ruleId}" is not a rule id of the form <layer>/<name>`);
  return parsed.data;
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** The gate's verdict line for one check. */
export function outcomeLine(decision: Pick<StudyDecision, "outcome">, rejectAbove = STUDY_REJECT_ABOVE): string {
  if (decision.outcome === "off-by-default") return `turn off by default (rejected > ${pct(rejectAbove)})`;
  if (decision.outcome === "stays-on") return "stays on";
  return "not enough data";
}

/** Findings the verdicts cover: exact when every verdict recorded it, `≥` a lower bound otherwise, `-` when none did. */
export function findingsCell(row: Pick<StudyDecision, "n" | "findings" | "findingsKnown">): string {
  if (row.findingsKnown === 0) return "-";
  return row.findingsKnown < row.n ? `≥${row.findings}` : String(row.findings);
}

/**
 * One row per check: verdicts, the findings they cover, accept %, reject % with
 * its 95% interval, and the gate's outcome. The gate counts verdicts (one per
 * fingerprint), not findings.
 */
export function formatStudyTable(decisions: ReadonlyArray<StudyDecision>, options: { rejectAbove?: number; books?: boolean } = {}): string[] {
  const header = ["check", ...(options.books ? ["books"] : []), "n", "findings", "accept", "reject (95% CI)", "verdict"];
  const rows = decisions.map((row) => [
    row.ruleId,
    ...(options.books ? [String(row.books)] : []),
    String(row.n),
    findingsCell(row),
    pct(row.acceptRate),
    `${pct(row.rejectRate)} (${pct(row.rejectInterval.low)}-${pct(row.rejectInterval.high)})`,
    outcomeLine(row, options.rejectAbove) + (row.settled ? "" : row.outcome === "not-enough-data" ? "" : ", not yet settled"),
  ]);
  const all = [header, ...rows];
  const widths = header.map((_, column) => Math.max(...all.map((row) => row[column]!.length)));
  // Text left, numbers right; the last column is not padded.
  const numeric = new Set(header.map((name, i) => (name === "check" || name === "verdict" ? -1 : i)).filter((i) => i >= 0));
  return all.map((row) => row.map((cell, column) =>
    column === row.length - 1 ? cell : numeric.has(column) ? cell.padStart(widths[column]!) : cell.padEnd(widths[column]!)).join("  ").trimEnd());
}

// `inkos lint` itself takes --json, so commander may hand a subcommand's --json to the parent.
const wantsJson = (command: Command) => command.optsWithGlobals<{ json?: boolean }>().json === true;

export function registerStudyCommands(lint: Command, listFindings: FindingLister): void {
  lint
    .command("study")
    .description("Writer-study report: accept and reject rates per check from the books' verdicts, and the phase 4 default-off gate")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--all", "Pool the verdicts of every book in the project")
    .option("--min <n>", `Standing verdicts a check needs before the gate decides (default ${STUDY_MIN_VERDICTS})`)
    .option("--reject-above <ratio>", `Turn off by default when more than this share reject it (default ${STUDY_REJECT_ABOVE})`)
    .option("--json", "Output JSON")
    .action(async (bookIdArg: string | undefined, opts: { all?: boolean; min?: string; rejectAbove?: string; json?: boolean }, command: Command) => {
      try {
        const json = wantsJson(command);
        const minVerdicts = parseMinVerdicts(opts.min);
        const rejectAbove = parseRejectAbove(opts.rejectAbove);
        if (opts.all && bookIdArg) throw new Error("give a book id or --all, not both");
        const root = findProjectRoot();
        const state = new StateManager(root);
        const bookIds = opts.all ? await state.listBooks() : [await resolveBookId(bookIdArg, root)];

        const books = await Promise.all(bookIds.map(async (id) => {
          const { verdicts, skipped } = await loadVerdicts(state.bookDir(id));
          return { id, verdicts, skipped };
        }));
        const decisions = studyReport(books.map((book) => verdictStats(book.verdicts)), { minVerdicts, rejectAbove });
        const offByDefault = decisions.filter((row) => row.outcome === "off-by-default").map((row) => row.ruleId);
        // What the author's verdicts already lowered in a single book, for context.
        const lowered = opts.all ? [] : adaptiveDecisions(books[0]!.verdicts);

        if (json) {
          log(JSON.stringify({
            books: books.map((book) => ({ id: book.id, verdicts: book.verdicts.length, skipped: book.skipped })),
            minVerdicts,
            rejectAbove,
            checks: decisions,
            offByDefault,
            ...(opts.all ? {} : { lowered }),
          }, null, 2));
          return;
        }
        for (const book of books) {
          if (book.skipped.length > 0) logError(`${book.id}: skipped unreadable lines ${book.skipped.join(", ")} in ${verdictsPath(state.bookDir(book.id))}`);
        }
        const scope = opts.all ? `${books.length} book${books.length === 1 ? "" : "s"}` : `"${books[0]!.id}"`;
        const total = books.reduce((sum, book) => sum + book.verdicts.length, 0);
        if (decisions.length === 0) {
          log(`${scope}: no verdicts yet (accept or reject findings in Studio, or run \`inkos lint verdict\`)`);
          return;
        }
        log(`${scope}: ${total} verdicts on ${decisions.length} checks; a check needs ${minVerdicts} to decide`);
        for (const line of formatStudyTable(decisions, { rejectAbove, books: opts.all === true })) log(`  ${line}`);
        log("  n counts one verdict per finding fingerprint; findings is how many flagged spans those verdicts covered (≥ where older verdicts did not record it). The gate uses n.");
        if (offByDefault.length > 0) log(`Turn off by default: ${offByDefault.join(", ")}`);
        for (const decision of lowered) log(`Lowered to ${decision.setting} in "${books[0]!.id}" by the author's verdicts: ${decision.ruleId}`);
      } catch (e) {
        logError(`Study failed: ${e}`);
        process.exit(1);
      }
    });

  lint
    .command("verdict")
    .description("Record a writer's verdict on one finding (fingerprints are in `inkos lint --json` or `--verbose`)")
    .argument("<verdict>", "accept or reject")
    .argument("<fingerprint>", "The finding's fingerprint")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--action <action>", `What the writer did: ${VerdictActionSchema.options.join(", ")} (default edited for accept, dismissed for reject)`)
    .option("--rule <rule-id>", "The finding's rule, to pick between findings sharing a fingerprint or record one no longer in the book")
    .option("--chapter <n>", "The finding's chapter, with --rule for a finding no longer in the book")
    .option("--author <name>", "Who decided")
    .option("--json", "Output JSON")
    .action(async (kindArg: string, fingerprint: string, bookIdArg: string | undefined, opts: {
      action?: string; rule?: string; chapter?: string; author?: string; json?: boolean;
    }, command: Command) => {
      try {
        const json = wantsJson(command);
        const action = parseVerdictAction(parseVerdictKind(kindArg), opts.action);
        if (opts.chapter !== undefined && !/^\d+$/u.test(opts.chapter)) throw new Error(`--chapter takes a chapter number; got "${opts.chapter}"`);
        const root = findProjectRoot();
        const bookId = await resolveBookId(bookIdArg, root);
        const state = new StateManager(root);
        const author = opts.author?.trim() ? { author: opts.author.trim() } : {};

        const matches = (await listFindings(state, bookId))
          .filter((finding) => finding.fingerprint === fingerprint && (!opts.rule || finding.ruleId === opts.rule));
        const rules = new Set(matches.map((finding) => finding.ruleId));
        if (rules.size > 1) throw new Error(`fingerprint ${fingerprint} matches findings of ${[...rules].join(", ")}; pass --rule`);

        let verdict: Verdict;
        if (matches[0]) {
          // Findings sharing the fingerprint (the same words flagged again) are covered by this one verdict.
          verdict = verdictOn(matches[0], action, { ...author, findings: matches.length });
        } else if (opts.rule) {
          // A finding the writer already fixed is gone from the book; record it from what was given.
          const layer = layerOfRuleId(opts.rule);
          verdict = {
            ruleId: opts.rule,
            fingerprint,
            ...(opts.chapter === undefined ? {} : { chapter: Number(opts.chapter) }),
            verdict: verdictOfAction(action),
            action,
            at: new Date().toISOString(),
            ...author,
            layer,
            confidence: DEFAULT_CONFIDENCE[layer],
          };
        } else {
          throw new Error(`No finding with fingerprint ${fingerprint} in "${bookId}". Run \`inkos lint ${bookId} --json\` to list fingerprints, or pass --rule for one already fixed.`);
        }

        const bookDir = state.bookDir(bookId);
        await appendVerdicts(bookDir, [verdict]);
        if (json) log(JSON.stringify({ bookId, verdict, path: verdictsPath(bookDir) }, null, 2));
        else log(`Recorded ${verdict.verdict} (${verdict.action}) for ${verdict.ruleId} finding ${fingerprint} in "${bookId}".`);
      } catch (e) {
        logError(`Verdict failed: ${e}`);
        process.exit(1);
      }
    });
}
