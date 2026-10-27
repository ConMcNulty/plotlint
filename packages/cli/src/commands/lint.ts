import { Command } from "commander";
import { StateManager, loadRuntimeStateSnapshot } from "@actalk/inkos-core";
import { checkSnapshot } from "@plotlint/rules";
import { formatDiagnostic, type Diagnostic } from "@plotlint/diagnostics";
import { findProjectRoot, log, logError } from "../utils.js";

export const lintCommand = new Command("lint")
  .description("Run plotlint's deterministic story checks over a book's runtime state")
  .argument("[book-id]", "Book ID (optional, checks all if omitted)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);
      const allBookIds = await state.listBooks();
      if (bookIdArg && !allBookIds.includes(bookIdArg)) {
        throw new Error(`Book "${bookIdArg}" not found. Available: ${allBookIds.join(", ") || "(none)"}`);
      }

      const results: Array<{ id: string; diagnostics: Diagnostic[]; stateMissing?: true }> = [];
      for (const id of bookIdArg ? [bookIdArg] : allBookIds) {
        try {
          const snapshot = await loadRuntimeStateSnapshot(state.bookDir(id));
          results.push({ id, diagnostics: checkSnapshot(snapshot) });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          results.push({ id, diagnostics: [], stateMissing: true });
        }
      }

      if (opts.json) {
        log(JSON.stringify({ books: results }, null, 2));
      } else {
        for (const result of results) {
          log(`${result.id}:`);
          if (result.stateMissing) log("  no runtime state yet");
          else if (result.diagnostics.length === 0) log("  no problems");
          for (const diagnostic of result.diagnostics) log(formatDiagnostic(diagnostic).replace(/^/gmu, "  "));
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
