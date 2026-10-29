import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { StateManager, chatCompletion, createLLMClient, loadWorkManifest, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import { draftMarkdown, manuscriptDocx, manuscriptWords, outline, parseChapter, roundedWordCount, submissionPackage, type SubmissionBook } from "@plotlint/export";
import { markdownReport, seedChapters, summarize } from "@plotlint/provenance";
import { baselineAuthor, loadProvenance } from "@plotlint/provenance/node";
import { findProjectRoot, loadConfig, log, logError, resolveBookId } from "../utils.js";

// `inkos lint export manuscript`: the book in standard manuscript format (.docx).
// `inkos lint export submission`: a folder with the outline (by code, from the
// chapter summaries), synopsis and query letter drafts (configured LLM), the
// provenance report, and the manuscript.

/** What the export commands borrow from lint.ts. */
export interface ExportCommandDeps {
  readonly chapterTexts: (bookDir: string) => Promise<ReadonlyMap<number, string>>;
  readonly loadSnapshot: (bookDir: string) => Promise<RuntimeStateSnapshot | undefined>;
  readonly withBackoff: <T>(call: () => Promise<T>) => Promise<T>;
}

interface ManuscriptFlags {
  readonly author?: string;
  readonly byline?: string;
  readonly surname?: string;
  readonly contact?: string[];
  readonly shortTitle?: string;
  readonly font?: string;
  readonly title?: string;
}

async function bookInfo(bookIdArg: string | undefined) {
  const root = findProjectRoot();
  const bookId = await resolveBookId(bookIdArg, root);
  const state = new StateManager(root);
  const config = await state.loadBookConfig(bookId).catch(() => undefined);
  const manifest = config ? undefined : await loadWorkManifest(root, bookId).catch(() => undefined);
  return {
    root, bookId, state, bookDir: state.bookDir(bookId),
    title: config?.title ?? manifest?.title ?? bookId,
    genre: config?.genre,
    language: (config?.language ?? manifest?.language ?? "en") as "en" | "zh",
  };
}

const collect = (value: string, previous: string[] = []) => [...previous, value];

function manuscriptOptions(command: Command): Command {
  return command
    .option("--author <name>", "Your legal name, for the contact block (required)")
    .option("--byline <name>", "The name to publish under, if different")
    .option("--surname <name>", "For the running header (default the byline's last word)")
    .option("--contact <line>", "A contact line (address, phone, email); repeat for more", collect)
    .option("--title <title>", "The title (default the book's)")
    .option("--short-title <title>", "For the running header (default the title's first words)")
    .option("--font <font>", "Times New Roman (default) or Courier New");
}

async function buildManuscript(info: Awaited<ReturnType<typeof bookInfo>>, texts: ReadonlyMap<number, string>, flags: ManuscriptFlags) {
  if (!flags.author?.trim()) throw new Error("--author is required: the manuscript's contact block needs your name");
  const chapters = [...texts].sort(([a], [b]) => a - b).map(([number, text]) => parseChapter(number, text));
  if (!chapters.length) throw new Error(`"${info.bookId}" has no chapters`);
  const buffer = await manuscriptDocx({
    title: flags.title ?? info.title,
    ...(flags.shortTitle ? { shortTitle: flags.shortTitle } : {}),
    ...(flags.font ? { font: flags.font } : {}),
    author: {
      name: flags.author.trim(),
      ...(flags.byline ? { byline: flags.byline } : {}),
      ...(flags.surname ? { surname: flags.surname } : {}),
      ...(flags.contact?.length ? { contact: flags.contact } : {}),
    },
    chapters,
  });
  return { buffer, chapters: chapters.length, words: manuscriptWords(chapters) };
}

export function addExportCommand(lint: Command, deps: ExportCommandDeps): void {
  const exporter = lint
    .command("export")
    .description("Export for submission: a standard manuscript (.docx) or a submission package");

  manuscriptOptions(exporter
    .command("manuscript")
    .description("The book in standard manuscript format: title page, 12pt double spacing, running header, scene breaks")
    .argument("[book-id]", "Book ID (auto-detected if only one book)"))
    .option("--output <file>", "Where to write it (default <book>-manuscript.docx in the project)")
    .action(async (bookIdArg: string | undefined, opts: ManuscriptFlags & { output?: string }) => {
      try {
        const info = await bookInfo(bookIdArg);
        const { buffer, chapters, words } = await buildManuscript(info, await deps.chapterTexts(info.bookDir), opts);
        const output = opts.output ?? join(info.root, `${info.bookId}-manuscript.docx`);
        await writeFile(output, buffer);
        log(`manuscript: ${chapters} chapters, ${words.toLocaleString("en")} words (about ${roundedWordCount(words).toLocaleString("en")})`);
        log(`output: ${output}`);
      } catch (e) {
        logError(`Export failed: ${e}`);
        process.exit(1);
      }
    });

  manuscriptOptions(exporter
    .command("submission")
    .description("A submission folder: outline, synopsis and query letter drafts from the chapter summaries, provenance report, and the manuscript")
    .argument("[book-id]", "Book ID (auto-detected if only one book)"))
    .option("--output <dir>", "Folder to write (default <book>-submission in the project)")
    .option("--genre <genre>", "The genre to name in the query (default the book's)")
    .option("--outline-only", "Only the outline and the provenance report: no LLM calls")
    .action(async (bookIdArg: string | undefined, opts: ManuscriptFlags & { output?: string; genre?: string; outlineOnly?: boolean }) => {
      try {
        const info = await bookInfo(bookIdArg);
        const texts = await deps.chapterTexts(info.bookDir);
        const snapshot = await deps.loadSnapshot(info.bookDir);
        const summaries = snapshot?.chapterSummaries.rows ?? [];
        const chapters = [...texts].map(([number, text]) => parseChapter(number, text));
        const book: SubmissionBook = {
          title: opts.title ?? info.title,
          ...(opts.genre ?? info.genre ? { genre: opts.genre ?? info.genre! } : {}),
          language: info.language,
          words: roundedWordCount(manuscriptWords(chapters)),
          summaries,
          names: [...new Set(snapshot?.currentState.facts.flatMap((fact) => [fact.subject, fact.object]) ?? [])],
        };
        const dir = opts.output ?? join(info.root, `${info.bookId}-submission`);
        await mkdir(dir, { recursive: true });
        const written: string[] = [];
        const write = async (name: string, content: string | Buffer) => {
          await writeFile(join(dir, name), content);
          written.push(name);
        };
        await write("outline.md", outline(book));

        // Provenance: chapters never recorded start from InkOS's chapter index, as the recorders do.
        const index = await info.state.loadChapterIndex(info.bookId).catch(() => []);
        const origin = new Map(index.map((entry) => [entry.number, baselineAuthor(entry.provenance)]));
        const provenance = seedChapters(await loadProvenance(info.bookDir), texts, (chapter) => origin.get(chapter) ?? "unknown");
        await write("provenance.md", markdownReport(summarize(provenance, texts), book.title));

        if (!opts.outlineOnly) {
          if (!summaries.length) throw new Error(`"${info.bookId}" has no chapter summaries yet; settle its chapters first, or pass --outline-only`);
          const config = await loadConfig({ requireApiKey: true });
          const client = createLLMClient(config.llm);
          const complete = async (messages: ReadonlyArray<{ role: "system" | "user"; content: string }>) =>
            deps.withBackoff(async () => (await chatCompletion(client, config.llm.model, [...messages], { temperature: 0.5, maxTokens: 8_192 })).content);
          log(`drafting the synopsis and query letter with ${config.llm.model}…`);
          const pack = await submissionPackage(book, complete);
          const zh = book.language === "zh";
          await write("synopsis.md", draftMarkdown(zh ? `${book.title}：故事梗概` : `${book.title}: synopsis`, pack.synopsis, book.language));
          await write("query.md", draftMarkdown(zh ? `${book.title}：投稿信` : `${book.title}: query letter`, pack.query, book.language));
          for (const [name, draft] of [["synopsis", pack.synopsis], ["query", pack.query]] as const) {
            if (draft.unknownNames.length) log(`  ${name}: check these names, which the book never uses: ${draft.unknownNames.join(", ")}`);
          }
        }
        if (opts.author) {
          const { buffer } = await buildManuscript(info, texts, opts);
          await write("manuscript.docx", buffer);
        }
        log(`submission package: ${dir}`);
        for (const name of written) log(`  ${name}`);
        if (!opts.author) log("  (pass --author to include the manuscript)");
      } catch (e) {
        logError(`Export failed: ${e}`);
        process.exit(1);
      }
    });
}
