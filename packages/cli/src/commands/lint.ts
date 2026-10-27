import { Command } from "commander";
import { StateManager, loadRuntimeStateSnapshot } from "@actalk/inkos-core";
import { checkSnapshot } from "@plotlint/rules";
import {
  applySuppressions,
  diagnosticFingerprint,
  formatDiagnostic,
  type Diagnostic,
  type Suppression,
} from "@plotlint/diagnostics";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";
import { addSuppression, loadSuppressions, removeSuppressions, suppressionsPath } from "@plotlint/diagnostics/node";

type FingerprintedDiagnostic = Diagnostic & { fingerprint: string };

interface BookLint {
  id: string;
  diagnostics: FingerprintedDiagnostic[];
  suppressed: Array<{ diagnostic: FingerprintedDiagnostic; suppression: Suppression }>;
  stateMissing?: true;
}

const withFingerprint = (diagnostic: Diagnostic): FingerprintedDiagnostic =>
  ({ ...diagnostic, fingerprint: diagnosticFingerprint(diagnostic) });

/** Run the checks over one book and split the findings by its saved suppressions. */
async function lintBook(state: StateManager, id: string): Promise<BookLint> {
  const bookDir = state.bookDir(id);
  const { suppressions } = await loadSuppressions(bookDir);
  let diagnostics: Diagnostic[];
  try {
    diagnostics = checkSnapshot(await loadRuntimeStateSnapshot(bookDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { id, diagnostics: [], suppressed: [], stateMissing: true };
  }
  const { kept, suppressed } = applySuppressions(diagnostics, suppressions);
  return {
    id,
    diagnostics: kept.map(withFingerprint),
    suppressed: suppressed.map((entry) => ({ diagnostic: withFingerprint(entry.diagnostic), suppression: entry.suppression })),
  };
}

const indent = (text: string) => text.replace(/^/gmu, "  ");

function formatFinding(diagnostic: FingerprintedDiagnostic, verbose: boolean): string {
  const text = formatDiagnostic(diagnostic);
  if (!verbose) return text;
  const [head, ...rest] = text.split("\n");
  return [`${head} (${diagnostic.fingerprint})`, ...rest].join("\n");
}

const describeSuppression = (suppression: Suppression) =>
  `${suppression.kind === "rule" ? "rule suppressed" : "suppressed"}: ${suppression.reason}`;

// `inkos lint` itself takes --json, so commander may hand a subcommand's --json to the parent.
const wantsJson = (command: Command) => command.optsWithGlobals<{ json?: boolean }>().json === true;

export const lintCommand = new Command("lint")
  .description("Run plotlint's deterministic story checks over a book's runtime state")
  .argument("[book-id]", "Book ID (optional, checks all if omitted)")
  .option("--json", "Output JSON")
  .option("--show-suppressed", "Also list findings hidden by suppressions")
  .option("--verbose", "Show each finding's fingerprint, for `inkos lint suppress --fingerprint`")
  .action(async (bookIdArg: string | undefined, opts: { json?: boolean; showSuppressed?: boolean; verbose?: boolean }) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);
      const allBookIds = await state.listBooks();
      if (bookIdArg && !allBookIds.includes(bookIdArg)) {
        throw new Error(`Book "${bookIdArg}" not found. Available: ${allBookIds.join(", ") || "(none)"}`);
      }

      const results: BookLint[] = [];
      for (const id of bookIdArg ? [bookIdArg] : allBookIds) results.push(await lintBook(state, id));

      if (opts.json) {
        log(JSON.stringify({ books: results }, null, 2));
      } else {
        const verbose = opts.verbose === true;
        for (const result of results) {
          log(`${result.id}:`);
          if (result.stateMissing) log("  no runtime state yet");
          else if (result.diagnostics.length === 0) log("  no problems");
          for (const diagnostic of result.diagnostics) log(indent(formatFinding(diagnostic, verbose)));
          if (result.suppressed.length === 0) continue;
          if (opts.showSuppressed) {
            for (const { diagnostic, suppression } of result.suppressed) {
              log(indent(`[${describeSuppression(suppression)}] ${formatFinding(diagnostic, verbose)}`));
            }
          } else {
            log(`  ${result.suppressed.length} suppressed (--show-suppressed to list)`);
          }
        }
      }

      if (results.some((result) => result.diagnostics.some((diagnostic) => diagnostic.severity === "error"))) {
        process.exitCode = 1;
      }
    } catch (e) {
      logError(`Lint failed: ${e}`);
      process.exit(1);
    }
  });

lintCommand
  .command("suppress")
  .description("Mark a finding as intentional (--fingerprint) or turn a check off for a whole book")
  .argument("<rule-id>", "Rule ID, e.g. continuity/dead-entity-acts")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .requiredOption("--reason <text>", "Why this is intentional; saved with the suppression")
  .option("--fingerprint <fp>", "Suppress one finding only (from `inkos lint --verbose` or `--json`)")
  .option("--author <name>", "Who suppressed it")
  .option("--json", "Output JSON")
  .action(async (ruleId: string, bookIdArg: string | undefined, opts: {
    reason: string; fingerprint?: string; author?: string; json?: boolean;
  }, command: Command) => {
    try {
      opts = { ...opts, json: wantsJson(command) };
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const reason = opts.reason.trim();
      if (!reason) throw new Error("--reason must not be empty");
      const createdAt = new Date().toISOString();
      const author = opts.author?.trim() ? { author: opts.author.trim() } : {};

      let suppression: Suppression;
      if (opts.fingerprint) {
        // Record where the finding is and what it said, so the file reads well to a human.
        const result = await lintBook(state, bookId);
        const finding = [...result.diagnostics, ...result.suppressed.map((entry) => entry.diagnostic)]
          .find((diagnostic) => diagnostic.ruleId === ruleId && diagnostic.fingerprint === opts.fingerprint);
        if (!finding) {
          throw new Error(`No ${ruleId} finding with fingerprint ${opts.fingerprint} in "${bookId}". Run \`inkos lint ${bookId} --verbose\` to list fingerprints.`);
        }
        suppression = {
          kind: "instance",
          ruleId,
          fingerprint: finding.fingerprint,
          reason,
          createdAt,
          ...author,
          ...(finding.chapter === undefined ? {} : { chapter: finding.chapter }),
          quote: finding.sourceRefs?.[0]?.quote ?? finding.summary,
        };
      } else {
        suppression = { kind: "rule", ruleId, reason, createdAt, ...author };
      }

      const bookDir = state.bookDir(bookId);
      const { replaced } = await addSuppression(bookDir, suppression);
      if (opts.json) {
        log(JSON.stringify({ bookId, suppression, replaced, path: suppressionsPath(bookDir) }, null, 2));
      } else {
        const what = suppression.kind === "rule" ? `all ${ruleId} findings` : `${ruleId} finding ${suppression.fingerprint}`;
        log(`${replaced ? "Updated" : "Suppressed"} ${what} in "${bookId}": ${reason}`);
      }
    } catch (e) {
      logError(`Suppress failed: ${e}`);
      process.exit(1);
    }
  });

lintCommand
  .command("unsuppress")
  .description("Remove a suppression: the rule-wide one, one instance (--fingerprint) or all for the rule (--all)")
  .argument("<rule-id>", "Rule ID, e.g. continuity/dead-entity-acts")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--fingerprint <fp>", "Remove the suppression of one finding")
  .option("--all", "Remove every suppression of this rule, rule-wide and per instance")
  .option("--json", "Output JSON")
  .action(async (ruleId: string, bookIdArg: string | undefined, opts: { fingerprint?: string; all?: boolean; json?: boolean }, command: Command) => {
    try {
      opts = { ...opts, json: wantsJson(command) };
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const removed = await removeSuppressions(new StateManager(root).bookDir(bookId), {
        ruleId,
        ...(opts.fingerprint ? { fingerprint: opts.fingerprint } : {}),
        all: opts.all === true,
      });
      if (opts.json) {
        log(JSON.stringify({ bookId, removed }, null, 2));
      } else if (removed.length === 0) {
        log(`No matching ${ruleId} suppression in "${bookId}".`);
      } else {
        log(`Removed ${removed.length} ${ruleId} suppression${removed.length === 1 ? "" : "s"} from "${bookId}".`);
      }
      if (removed.length === 0) process.exitCode = 1;
    } catch (e) {
      logError(`Unsuppress failed: ${e}`);
      process.exit(1);
    }
  });
