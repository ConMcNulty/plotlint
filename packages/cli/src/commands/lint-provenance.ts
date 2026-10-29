import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { StateManager } from "@actalk/inkos-core";
import { AuthorIdSchema, markdownReport, reconcile, spans, summarize, withChapter } from "@plotlint/provenance";
import { baselineAuthor, loadProvenance, saveProvenance } from "@plotlint/provenance/node";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";

// `inkos lint provenance`: who wrote how much of the book (story/plotlint/provenance.json),
// with a report a writer can attach to a submission. `inkos lint provenance record`
// attributes changes made outside plotlint's recorders (an outside editor, a paste)
// to the author who made them, instead of leaving them unknown.

/** What the provenance commands borrow from lint.ts. */
export interface ProvenanceCommandDeps {
  readonly chapterTexts: (bookDir: string) => Promise<ReadonlyMap<number, string>>;
  readonly parseChapter: (value: string | undefined) => number | undefined;
}

const wantsJson = (command: Command) => command.optsWithGlobals<{ json?: boolean }>().json === true;
const pct = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);

async function load(bookIdArg: string | undefined, deps: ProvenanceCommandDeps) {
  const root = findProjectRoot();
  const bookId = await resolveBookId(bookIdArg, root);
  const state = new StateManager(root);
  const bookDir = state.bookDir(bookId);
  const [file, texts, index] = await Promise.all([loadProvenance(bookDir), deps.chapterTexts(bookDir), state.loadChapterIndex(bookId).catch(() => [])]);
  const origin = new Map(index.map((entry) => [entry.number, baselineAuthor(entry.provenance)]));
  // A chapter with no record yet is attributed from InkOS's chapter index, as the recorders do.
  const seeded = [...texts].reduce((acc, [chapter, text]) =>
    acc.chapters.some((entry) => entry.chapter === chapter) ? acc : withChapter(acc, reconcile(undefined, chapter, text, undefined, origin.get(chapter) ?? "unknown")), file);
  return { bookId, bookDir, file, seeded, texts, origin };
}

export function addProvenanceCommand(lint: Command, deps: ProvenanceCommandDeps): void {
  const provenance = lint
    .command("provenance")
    .description("Who wrote each passage: shares by person, AI agent, import and unknown, per chapter (story/plotlint/provenance.json)")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--chapter <n>", "List one chapter's passages and their authors")
    .option("--report <file>", "Write a Markdown provenance report to this file")
    .option("--json", "Output JSON")
    .action(async (bookIdArg: string | undefined, opts: { chapter?: string; report?: string }, command: Command) => {
      try {
        const { bookId, seeded, texts } = await load(bookIdArg, deps);
        const summary = summarize(seeded, texts);
        const only = deps.parseChapter(opts.chapter ?? command.optsWithGlobals<{ chapter?: string }>().chapter);
        if (only !== undefined && !texts.has(only)) throw new Error(`"${bookId}" has no chapter ${only}`);
        const record = only === undefined ? undefined : reconcile(seeded.chapters.find((entry) => entry.chapter === only), only, texts.get(only)!);
        if (opts.report) {
          await writeFile(opts.report, markdownReport(summary, bookId), "utf-8");
          if (!wantsJson(command)) log(`report: ${opts.report}`);
        }
        if (wantsJson(command)) {
          log(JSON.stringify({ bookId, ...summary, ...(record ? { spans: spans(record).map((span) => ({ ...span, text: texts.get(only!)!.slice(span.start, span.end) })) } : {}) }, null, 2));
          return;
        }
        if (record) {
          for (const segment of record.segments) {
            const text = segment.text.replace(/\s+/gu, " ").trim();
            if (text) log(`  ${segment.by}${segment.via ? ` (${segment.via})` : ""}: ${text.length > 90 ? `${text.slice(0, 87)}...` : text}`);
          }
          return;
        }
        const kinds = (byKind: typeof summary.byKind) => (["human", "agent", "import", "unknown"] as const).map((kind) => `${kind} ${pct(byKind[kind]?.share ?? 0)}`).join(", ");
        log(`${bookId}: ${summary.words} words; ${kinds(summary.byKind)}`);
        for (const [author, share] of Object.entries(summary.byAuthor)) log(`  ${author}: ${share.words} words (${pct(share.share)})`);
        for (const chapter of summary.chapters) log(`  ch${chapter.chapter}${chapter.current ? "" : "*"}: ${chapter.words} words; ${kinds(chapter.byKind)}`);
        if (summary.chapters.some((chapter) => !chapter.current)) log("  * changed since it was last recorded; the difference counts as unknown until `inkos lint provenance record`");
      } catch (e) {
        logError(`Provenance failed: ${e}`);
        process.exit(1);
      }
    });

  provenance
    .command("record")
    .description("Attribute a chapter's changes since it was last recorded to one author, such as your own edits in another editor")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .requiredOption("--by <author>", "Who made the changes: human[:name], agent:<name>[@model], import[:source]")
    .option("--chapter <n>", "Only this chapter (default every chapter that changed)")
    .option("--via <tool>", "What made the change (default cli)")
    .action(async (bookIdArg: string | undefined, opts: { by: string; chapter?: string; via?: string }, command: Command) => {
      try {
        const by = AuthorIdSchema.parse(opts.by);
        const { bookId, bookDir, file, texts, origin } = await load(bookIdArg, deps);
        const only = deps.parseChapter(opts.chapter ?? command.optsWithGlobals<{ chapter?: string }>().chapter);
        if (only !== undefined && !texts.has(only)) throw new Error(`"${bookId}" has no chapter ${only}`);
        const change = { by, at: new Date().toISOString(), via: opts.via ?? "cli" };
        let next = file;
        const recorded: number[] = [];
        for (const [chapter, text] of texts) {
          if (only !== undefined && chapter !== only) continue;
          const stored = file.chapters.find((entry) => entry.chapter === chapter);
          // A chapter never recorded starts from its index origin; only later changes are `by`'s.
          const record = reconcile(stored, chapter, text, change, origin.get(chapter) ?? "unknown");
          if (record === stored) continue;
          next = withChapter(next, record);
          recorded.push(chapter);
        }
        await saveProvenance(bookDir, next);
        log(recorded.length ? `recorded ${recorded.map((chapter) => `ch${chapter}`).join(", ")} (changes by ${by})` : "nothing changed since the last record");
      } catch (e) {
        logError(`Provenance record failed: ${e}`);
        process.exit(1);
      }
    });
}
