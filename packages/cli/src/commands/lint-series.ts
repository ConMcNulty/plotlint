import type { Command } from "commander";
import { StateManager } from "@actalk/inkos-core";
import { SeriesFileSchema } from "@plotlint/rules";
import { loadSeriesPrelude, readPlotlintFile, writePlotlintFile } from "@plotlint/rules/node";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";

// `inkos lint series`: name the books that come before this one in a series
// (`story/plotlint/series.json`), and list what their end state carries into it.
// `inkos lint` then checks this book against that state.

export interface SeriesCommandDeps {
  readonly bookTitle: (state: StateManager, id: string) => Promise<string>;
}

const wantsJson = (command: Command) => command.optsWithGlobals<{ json?: boolean }>().json === true;

export function addSeriesCommand(lint: Command, deps: SeriesCommandDeps): void {
  lint
    .command("series")
    .description("Check a book against the books before it in its series: name them with --after, or list what they carry in")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--after <ids>", "The earlier books in reading order, comma-separated; an empty string takes the book out of a series")
    .option("--json", "Output JSON")
    .action(async (bookIdArg: string | undefined, opts: { after?: string }, command: Command) => {
      try {
        const root = findProjectRoot();
        const bookId = await resolveBookId(bookIdArg, root);
        const state = new StateManager(root);
        const bookDir = state.bookDir(bookId);
        if (opts.after !== undefined) {
          const after = opts.after.split(",").map((id) => id.trim()).filter(Boolean);
          const books = await state.listBooks().catch((): ReadonlyArray<string> => []);
          for (const id of after) if (books.length && !books.includes(id)) throw new Error(`no book "${id}" in this project`);
          await writePlotlintFile(bookDir, "series.json", SeriesFileSchema, { version: 1, after });
        }
        const series = await readPlotlintFile(bookDir, "series.json", SeriesFileSchema);
        const prelude = await loadSeriesPrelude(bookDir, bookId, async (id) => ({ bookDir: state.bookDir(id), title: await deps.bookTitle(state, id) }));
        if (wantsJson(command)) {
          log(JSON.stringify({ bookId, after: series?.after ?? [], facts: prelude?.facts ?? [], invariants: prelude?.invariants?.invariants.length ?? 0 }, null, 2));
          return;
        }
        if (!prelude) {
          log(`${bookId} is not in a series (set one with --after <earlier-book-ids>)`);
          return;
        }
        log(`${bookId} follows ${prelude.books.map((book) => `${book.title} (${book.id})`).join(", then ")}`);
        for (const book of prelude.books) {
          const facts = prelude.facts.filter((entry) => entry.book === book.id);
          log(`  from ${book.title}: ${facts.length} fact${facts.length === 1 ? "" : "s"} still standing at its end`);
          for (const entry of facts.slice(0, 12)) log(`    ${entry.fact.subject} · ${entry.fact.predicate} · ${entry.fact.object} (ch${entry.chapter})`);
          if (facts.length > 12) log(`    … and ${facts.length - 12} more (--json lists them all)`);
        }
        if (prelude.invariants) log(`  ${prelude.invariants.invariants.length} approved invariant(s) carried from earlier books`);
      } catch (e) {
        logError(`Series failed: ${e}`);
        process.exit(1);
      }
    });
}
