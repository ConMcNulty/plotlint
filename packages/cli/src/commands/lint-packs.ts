import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { StateManager, chatCompletion, createLLMClient, loadWorkManifest } from "@actalk/inkos-core";
import {
  builtinRegistry, PacksFileSchema, readRuleSetting, type BookRuleData, type PacksFile, type RuleConfigFile, type RuleSetting,
} from "@plotlint/rules";
import type { DiagnosticLayer } from "@plotlint/diagnostics";
import { createHarperRule } from "@plotlint/mechanics";
import { createMetricRules, metricStateRules } from "@plotlint/metrics";
import { loadAdaptiveOverlay, loadBookRuleData, plotlintDir, readPlotlintFile, writePlotlintFile } from "@plotlint/rules/node";
import {
  bookPackCatalog, builtinPacks, GENERAL_PACK, knownRuleIds, proposeFromGenre, proposePacks, resolveBookPacks, resolvePacks, type BookPacks, type PackProposal,
} from "@plotlint/packs/node";
import { findProjectRoot, loadConfig, log, logError, resolveBookId } from "../utils.js";

// `inkos lint packs`: the book's genre check packs, in `story/plotlint/packs.json`.
// The general pack always runs; the writer agent (or InkOS's genre field) proposes
// genre packs, and they only run once the author accepts or picks them.

const PACKS = "packs.json";

export { knownRuleIds };

/** Where the adaptive overlay's settings show up in provenance. */
export const ADAPTIVE_SOURCE = "adaptive";

/**
 * Where a rule's effective setting comes from, highest layer first: the book's
 * rules.json, the adaptive overlay (checks the author keeps rejecting), the packs
 * that set it, or the rule's own default.
 */
export function settingSource(id: string, packs: BookPacks, book: BookRuleData, overlay?: RuleConfigFile): string[] {
  if (id in (book.config?.rules ?? {})) return ["rules.json"];
  if (overlay && id in overlay.rules) return [ADAPTIVE_SOURCE];
  return packs.resolved.provenance[id] ?? ["default"];
}

export interface EffectiveRule {
  readonly id: string;
  readonly layer: DiagnosticLayer;
  readonly title: string;
  readonly rationale: string;
  readonly source?: string;
  readonly enabled: boolean;
  readonly severity?: string;
  readonly options?: Record<string, unknown>;
  /** The metric band, for L2 rules. */
  readonly band?: unknown;
  /** See `settingSource`. */
  readonly from: string[];
}

/**
 * Every rule `inkos lint` runs for a book (state, Harper, metric and the packs'
 * style rules) with its effective setting and where that setting comes from.
 * Without a book, the defaults of the general pack.
 */
export async function effectiveRules(bookDir: string | undefined): Promise<{ rules: EffectiveRule[]; unknown: string[] }> {
  const book: BookRuleData = bookDir ? await loadBookRuleData(bookDir) : {};
  const overlay = bookDir ? await loadAdaptiveOverlay(bookDir) : undefined;
  // A missing folder has no book packs, so the general pack resolves alone.
  const packs = bookPacks(bookDir ?? join(process.cwd(), ".no-book"), book, [overlay]);
  type Described = { id: string; layer: DiagnosticLayer; rationale: string; title?: string; source?: string };
  const described: Described[] = [
    ...builtinRegistry.list(),
    createHarperRule() as Described,
    ...createMetricRules(packs.metrics),
    ...metricStateRules(),
    ...packs.styleRules,
  ];
  const known = new Set(described.map((rule) => rule.id));
  const rules = described.map((rule): EffectiveRule => {
    const { enabled, severity, options } = readRuleSetting(packs.config.rules[rule.id] as RuleSetting | undefined);
    return {
      id: rule.id,
      layer: rule.layer,
      title: rule.title ?? rule.id,
      rationale: rule.rationale,
      ...(rule.source ? { source: rule.source } : {}),
      enabled,
      ...(severity ? { severity } : {}),
      ...(Object.keys(options).length ? { options } : {}),
      ...(rule.id in packs.metrics ? { band: packs.metrics[rule.id] } : {}),
      from: settingSource(rule.id, packs, book, overlay),
    };
  });
  return { rules, unknown: Object.keys(book.config?.rules ?? {}).filter((id) => !known.has(id)) };
}

/** The packs a book runs, resolved with its rules.json on top; warns about selected packs that do not exist. */
export function bookPacks(bookDir: string, book: BookRuleData, overlays: ReadonlyArray<RuleConfigFile | undefined> = []): BookPacks {
  const packs = resolveBookPacks(bookDir, book, knownRuleIds(), overlays);
  for (const name of packs.missing) logError(`pack "${name}" in story/plotlint/${PACKS} is not a known pack`);
  return packs;
}

/** Parse `use` names: comma or space separated, lowercased, without duplicates. */
export function parsePackNames(values: ReadonlyArray<string>): string[] {
  const names = values.flatMap((value) => value.split(",")).map((name) => name.trim().toLowerCase()).filter(Boolean);
  return [...new Set(names)];
}

const wantsJson = (command: Command) => command.optsWithGlobals<{ json?: boolean }>().json === true;
const indent = (text: string) => text.replace(/^/gmu, "  ");

async function loadPacksFile(bookDir: string): Promise<PacksFile> {
  return await readPlotlintFile(bookDir, PACKS, PacksFileSchema) ?? { version: 1, packs: [] };
}

const savePacks = (bookDir: string, file: PacksFile) => writePlotlintFile(bookDir, PACKS, PacksFileSchema, file);

/** Check a selection resolves (known packs, no cycles) before saving it. */
function checkSelection(bookDir: string, names: ReadonlyArray<string>): string[] {
  const selected = names.filter((name) => name !== GENERAL_PACK);
  resolvePacks(selected, bookPackCatalog(bookDir));
  return selected;
}

/** Title, genre and brief from InkOS's book config (or the Work manifest), and the opening chapters. */
async function bookContext(root: string, state: StateManager, bookId: string): Promise<{ title?: string; genre?: string; brief?: string; chapters: string[] }> {
  const bookDir = state.bookDir(bookId);
  let title: string | undefined;
  let genre: string | undefined;
  try {
    const config = await state.loadBookConfig(bookId);
    title = config.title;
    genre = config.genre;
  } catch {
    try {
      const work = await loadWorkManifest(root, bookId);
      title = work.title;
      genre = typeof work.metadata.genre === "string" ? work.metadata.genre : undefined;
    } catch {
      // A bare book folder: no title or genre to go on.
    }
  }
  const brief = await readFile(join(bookDir, "story", "author_intent.md"), "utf-8").catch(() => undefined);
  const files = await readdir(join(bookDir, "chapters")).catch(() => [] as string[]);
  const opening = files.filter((file) => /^\d+_.*\.md$/u.test(file)).sort().slice(0, 2);
  const chapters = await Promise.all(opening.map((file) => readFile(join(bookDir, "chapters", file), "utf-8")));
  return {
    ...(title ? { title } : {}), ...(genre ? { genre } : {}), ...(brief?.trim() ? { brief: brief.replace(/\r\n/gu, "\n") } : {}),
    chapters: chapters.map((text) => text.replace(/\r\n/gu, "\n")),
  };
}

/** Where each rule's effective setting comes from (see `settingSource`). */
function provenanceRows(packs: BookPacks, book: BookRuleData, overlay?: RuleConfigFile) {
  const ids = new Set([...Object.keys(packs.config.rules), ...Object.keys(packs.metrics)]);
  return [...ids].sort().map((id) => ({
    id,
    ...(id in packs.config.rules ? { setting: packs.config.rules[id] } : {}),
    ...(id in packs.metrics ? { band: packs.metrics[id] } : {}),
    from: settingSource(id, packs, book, overlay),
  }));
}

const describeSetting = (setting: unknown) => (typeof setting === "string" ? setting : JSON.stringify(setting));

export function addPacksCommand(lintCommand: Command): void {
  const packsCommand = lintCommand
    .command("packs")
    .description("Genre check packs: list them with the book's selection, or `use`, `propose` and `accept` packs")
    .argument("[book-id]", "Book ID (auto-detected if only one book); without a project, lists the packs")
    .option("--json", "Output JSON")
    .action(async (bookIdArg: string | undefined, opts: { json?: boolean }, command: Command) => {
      try {
        const json = opts.json === true || wantsJson(command);
        let bookId: string | undefined;
        let bookDir: string | undefined;
        try {
          const root = findProjectRoot();
          bookId = await resolveBookId(bookIdArg, root);
          bookDir = new StateManager(root).bookDir(bookId);
        } catch (error) {
          if (bookIdArg !== undefined) throw error;
        }
        const catalog = bookDir ? bookPackCatalog(bookDir) : builtinPacks();
        const available = [...catalog.values()].map(({ manifest }) => ({ name: manifest.name, title: manifest.title, description: manifest.description }));
        if (!bookDir) {
          if (json) log(JSON.stringify({ available }, null, 2));
          else for (const pack of available) log(`${pack.name}  ${pack.title}\n${indent(pack.description)}`);
          return;
        }
        const book = await loadBookRuleData(bookDir);
        const overlay = await loadAdaptiveOverlay(bookDir);
        const packs = bookPacks(bookDir, book, [overlay]);
        const rules = provenanceRows(packs, book, overlay);
        if (json) {
          log(JSON.stringify({
            bookId, available, selected: packs.resolved.selected, packs: packs.resolved.packs,
            ...(book.packs?.proposed ? { proposed: book.packs.proposed } : {}), missing: packs.missing, rules,
            path: join(plotlintDir(bookDir), PACKS),
          }, null, 2));
          return;
        }
        const running = new Set(packs.resolved.packs);
        log("Available packs:");
        for (const pack of available) log(`  ${running.has(pack.name) ? "*" : " "} ${pack.name}  ${pack.title}${pack.name === GENERAL_PACK ? " (always on)" : ""}`);
        log(`${bookId}: ${packs.resolved.packs.join(" + ")}`);
        if (book.packs?.proposed) {
          log(`  proposed: ${book.packs.proposed.packs.join(" + ") || "(general only)"} (inkos lint packs accept)`);
          log(indent(indent(book.packs.proposed.reasoning)));
        } else if (!book.packs) {
          log("  no packs chosen yet (inkos lint packs propose, or inkos lint packs use <names...>)");
        }
        for (const row of rules) {
          const value = [row.setting === undefined ? "" : describeSetting(row.setting), row.band ? `band ${JSON.stringify(row.band)}` : ""].filter(Boolean).join(", ");
          log(`  ${row.id}  ${value}  (${row.from.join(", ")})`);
        }
      } catch (e) {
        logError(`Packs failed: ${e}`);
        process.exit(1);
      }
    });

  packsCommand
    .command("use")
    .description("Choose the book's genre packs (the general pack always runs); `use general` keeps only the general pack")
    .argument("<names...>", "Pack names, e.g. romance fantasy")
    .option("--book <id>", "Book ID (auto-detected if only one book)")
    .option("--json", "Output JSON")
    .action(async (names: string[], opts: { book?: string; json?: boolean }, command: Command) => {
      try {
        const root = findProjectRoot();
        const bookId = await resolveBookId(opts.book, root);
        const bookDir = new StateManager(root).bookDir(bookId);
        const selected = checkSelection(bookDir, parsePackNames(names));
        const file = await loadPacksFile(bookDir);
        const { proposed: _dropped, ...rest } = file;
        const path = await savePacks(bookDir, { ...rest, packs: selected });
        if (opts.json || wantsJson(command)) log(JSON.stringify({ bookId, packs: selected, path }, null, 2));
        else log(`"${bookId}" now runs ${[GENERAL_PACK, ...selected].join(" + ")}.`);
      } catch (e) {
        logError(`Packs use failed: ${e}`);
        process.exit(1);
      }
    });

  packsCommand
    .command("propose")
    .description("Propose packs from the book's genre field, or ask the configured LLM from the brief and opening chapters")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--llm", "Ask the LLM even when the genre field maps to packs")
    .option("--json", "Output JSON")
    .action(async (bookIdArg: string | undefined, opts: { llm?: boolean; json?: boolean }, command: Command) => {
      try {
        const root = findProjectRoot();
        const bookId = await resolveBookId(bookIdArg, root);
        const state = new StateManager(root);
        const bookDir = state.bookDir(bookId);
        const catalog = bookPackCatalog(bookDir);
        const context = await bookContext(root, state, bookId);
        let proposal: PackProposal | undefined = opts.llm ? undefined : proposeFromGenre(context.genre, catalog);
        let source = "genre";
        if (!proposal) {
          // The global --service/--base-url/--api-format/--model/--api-key-env flags apply, as for every LLM command.
          const config = await loadConfig({ requireApiKey: true });
          const client = createLLMClient(config.llm);
          proposal = await proposePacks(context, catalog, async (messages) =>
            (await chatCompletion(client, config.llm.model, messages, { temperature: 0, maxTokens: 8_192 })).content);
          source = "llm";
        }
        const file = await loadPacksFile(bookDir);
        const proposed = { packs: checkSelection(bookDir, proposal.packs), reasoning: proposal.reasoning, at: new Date().toISOString() };
        const path = await savePacks(bookDir, { ...file, proposed });
        if (opts.json || wantsJson(command)) {
          log(JSON.stringify({ bookId, source, proposed, path }, null, 2));
          return;
        }
        log(`Proposed for "${bookId}": ${[GENERAL_PACK, ...proposed.packs].join(" + ")}`);
        log(indent(proposed.reasoning));
        log("Run `inkos lint packs accept` to use it, or `inkos lint packs use <names...>` to choose others.");
      } catch (e) {
        logError(`Packs propose failed: ${e}`);
        process.exit(1);
      }
    });

  packsCommand
    .command("accept")
    .description("Accept the proposed packs, so `inkos lint` runs them")
    .argument("[book-id]", "Book ID (auto-detected if only one book)")
    .option("--json", "Output JSON")
    .action(async (bookIdArg: string | undefined, opts: { json?: boolean }, command: Command) => {
      try {
        const root = findProjectRoot();
        const bookId = await resolveBookId(bookIdArg, root);
        const bookDir = new StateManager(root).bookDir(bookId);
        const file = await loadPacksFile(bookDir);
        if (!file.proposed) throw new Error(`No proposal for "${bookId}". Run \`inkos lint packs propose\` first.`);
        const selected = checkSelection(bookDir, file.proposed.packs);
        const path = await savePacks(bookDir, { version: 1, packs: selected });
        if (opts.json || wantsJson(command)) log(JSON.stringify({ bookId, packs: selected, path }, null, 2));
        else log(`"${bookId}" now runs ${[GENERAL_PACK, ...selected].join(" + ")}.`);
      } catch (e) {
        logError(`Packs accept failed: ${e}`);
        process.exit(1);
      }
    });
}
