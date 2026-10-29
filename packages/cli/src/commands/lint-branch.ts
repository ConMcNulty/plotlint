import { cp, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { StateManager, workDirectory, type RuntimeStateSnapshot } from "@actalk/inkos-core";
import { diffBranches, type BranchDiff } from "@plotlint/rules";
import { branchId, copyWork, createBranch, listBranches, parseBranchName, workExists } from "@plotlint/rules/node";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";

// `inkos lint branch`: what-if branches. A branch is a copy of the book as a book of
// its own (`<book>--<name>`), so InkOS writes, settles and audits it like any other
// and plotlint lints it; `diff` shows how its text and world state differ from the
// main line, and `adopt` makes it the main line (keeping the old one as a branch).

export interface BranchCommandDeps {
  readonly chapterTexts: (bookDir: string) => Promise<ReadonlyMap<number, string>>;
  readonly loadSnapshot: (bookDir: string) => Promise<RuntimeStateSnapshot | undefined>;
}

const wantsJson = (command: Command) => command.optsWithGlobals<{ json?: boolean }>().json === true;

function formatDiff(diff: BranchDiff, name: string): string[] {
  const lines: string[] = [];
  lines.push(diff.chapters.length ? `text: ${diff.chapters.length} chapter${diff.chapters.length === 1 ? "" : "s"} differ` : "text: the same");
  for (const change of diff.chapters) {
    lines.push(`  ch${change.chapter} ${change.status === "changed" ? `+${change.wordsAdded} −${change.wordsRemoved} words` : change.status === "added" ? `only on ${name} (${change.wordsAdded} words)` : `only on the main line (${change.wordsRemoved} words)`}`);
  }
  lines.push(diff.facts.length ? `world state at the end: ${diff.facts.length} difference${diff.facts.length === 1 ? "" : "s"}` : "world state at the end: the same");
  for (const change of diff.facts) {
    lines.push(`  ${change.subject} · ${change.predicate}: ${change.main ?? "(none)"} → ${change.branch ?? "(none)"}`);
  }
  if (diff.hooks.length) {
    lines.push(`hooks: ${diff.hooks.length} differ`);
    for (const change of diff.hooks) lines.push(`  ${change.id}: ${change.main ?? "(none)"} → ${change.branch ?? "(none)"} (${change.promise})`);
  }
  return lines;
}

export function addBranchCommand(lint: Command, deps: BranchCommandDeps): void {
  const branch = lint
    .command("branch")
    .description("What-if branches: copy the book to try a different course, compare text and world state, adopt the one you keep");

  branch
    .command("create")
    .description("Branch the book as it is now: a copy named <book>--<name> that InkOS and plotlint work on like any book")
    .argument("<name>", "Branch name: lowercase letters, digits and dashes")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .action(async (nameArg: string, bookIdArg: string | undefined) => {
      try {
        const root = findProjectRoot();
        const bookId = await resolveBookId(bookIdArg, root);
        const id = await createBranch(root, bookId, nameArg);
        log(`branched ${bookId} as ${id}; write and revise it with any command, e.g. inkos write next ${id}`);
      } catch (e) {
        logError(`Branch failed: ${e}`);
        process.exit(1);
      }
    });

  branch
    .command("list")
    .description("The book's branches")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--json", "Output JSON")
    .action(async (bookIdArg: string | undefined, _opts: unknown, command: Command) => {
      try {
        const root = findProjectRoot();
        const bookId = await resolveBookId(bookIdArg, root);
        const branches = await listBranches(root, bookId);
        if (wantsJson(command)) log(JSON.stringify({ bookId, branches }, null, 2));
        else if (!branches.length) log(`${bookId} has no branches (inkos lint branch create <name>)`);
        else for (const entry of branches) log(`  ${entry.name.padEnd(20)} ${entry.id}  since ${entry.createdAt.slice(0, 10)}`);
      } catch (e) {
        logError(`Branch list failed: ${e}`);
        process.exit(1);
      }
    });

  branch
    .command("diff")
    .description("How a branch differs from the main line: chapters, the world state at the end, and hooks")
    .argument("<name>", "Branch name")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--json", "Output JSON")
    .action(async (nameArg: string, bookIdArg: string | undefined, _opts: unknown, command: Command) => {
      try {
        const name = parseBranchName(nameArg);
        const root = findProjectRoot();
        const bookId = await resolveBookId(bookIdArg, root);
        const state = new StateManager(root);
        const id = branchId(bookId, name);
        if (!await workExists(root, id)) throw new Error(`"${bookId}" has no branch "${name}"`);
        const side = async (book: string) => {
          const snapshot = await deps.loadSnapshot(state.bookDir(book));
          return { texts: await deps.chapterTexts(state.bookDir(book)), ...(snapshot ? { snapshot } : {}) };
        };
        const diff = diffBranches(await side(bookId), await side(id));
        if (wantsJson(command)) log(JSON.stringify({ bookId, branch: name, branchId: id, ...diff }, null, 2));
        else {
          log(`${bookId} → ${id}`);
          for (const line of formatDiff(diff, name)) log(line);
        }
      } catch (e) {
        logError(`Branch diff failed: ${e}`);
        process.exit(1);
      }
    });

  branch
    .command("adopt")
    .description("Make a branch the main line: its chapters and story state replace the book's, and the old main line is kept as a branch")
    .argument("<name>", "Branch name")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--yes", "Confirm: the book's chapters and state are replaced (the old ones are kept as a branch)")
    .action(async (nameArg: string, bookIdArg: string | undefined, opts: { yes?: boolean }) => {
      try {
        const name = parseBranchName(nameArg);
        const root = findProjectRoot();
        const bookId = await resolveBookId(bookIdArg, root);
        const id = branchId(bookId, name);
        if (!await workExists(root, id)) throw new Error(`"${bookId}" has no branch "${name}"`);
        if (!opts.yes) throw new Error(`this replaces ${bookId}'s chapters and story state with ${id}'s; pass --yes to go ahead`);
        const keep = `before-${name}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/gu, "").toLowerCase()}`;
        await copyWork(root, bookId, branchId(bookId, keep), (title) => `${title} (${keep})`, { plotlintBranchOf: bookId, plotlintBranch: keep, plotlintBranchedAt: new Date().toISOString() });
        const source = join(workDirectory(root, bookId), "source");
        const from = join(workDirectory(root, id), "source");
        for (const part of ["chapters", "story"]) {
          // Copied beside it first, then swapped, so a failed copy leaves the book as it was.
          const incoming = join(source, `.${part}.adopting`);
          await rm(incoming, { recursive: true, force: true });
          await mkdir(incoming, { recursive: true });
          await cp(join(from, part), incoming, { recursive: true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
          await rm(join(source, part), { recursive: true, force: true });
          await rename(incoming, join(source, part));
        }
        log(`adopted ${id} as ${bookId}; the previous main line is kept as branch ${keep}`);
      } catch (e) {
        logError(`Branch adopt failed: ${e}`);
        process.exit(1);
      }
    });
}
