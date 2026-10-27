import { Dialect, LocalLinter, SuggestionKind, type Lint } from "harper.js";
import { binary } from "harper.js/binary";
import type { Diagnostic } from "@plotlint/diagnostics";
import { textDiagnostic, type TextRule, type TextRuleContext } from "@plotlint/rules";

export { Dialect } from "harper.js";

export interface HarperRuleOptions {
  readonly dialect?: Dialect;
  /** How Harper parses the text. InkOS chapters are Markdown files, so that is the default. */
  readonly language?: "plaintext" | "markdown";
}

const RULE = { id: "mechanics/harper", layer: "mechanics" } as const;
const RATIONALE = "Spelling and grammar slips distract readers and editors from the story; Harper checks English locally and fast enough to run as you type.";

// Harper kinds that are matters of taste rather than errors; everything else is a warning.
const NOTE_KINDS = new Set(["Enhancement", "Formatting", "Readability", "Redundancy", "Regionalism", "Repetition", "Style", "WordChoice"]);

export interface HarperHandle {
  readonly linter: LocalLinter;
  wordsKey: string;
  // The linter's user dictionary is shared state, so dictionary swaps and lints run one at a time.
  queue: Promise<unknown>;
}

const handles = new Map<Dialect, Promise<HarperHandle>>();

/**
 * The shared Harper linter for a dialect. Loading the WebAssembly binary takes
 * about a second, so it happens once per process; call this early to warm up.
 */
export function harperLinter(dialect: Dialect = Dialect.American): Promise<HarperHandle> {
  let handle = handles.get(dialect);
  if (!handle) {
    handle = (async () => {
      const linter = new LocalLinter({ binary, dialect });
      await linter.setup();
      return { linter, wordsKey: "", queue: Promise.resolve() };
    })();
    handles.set(dialect, handle);
  }
  return handle;
}

function serialize<T>(handle: HarperHandle, task: () => Promise<T>): Promise<T> {
  const run = handle.queue.then(task, task);
  handle.queue = run.catch(() => undefined);
  return run;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const LATIN = /\p{Script=Latin}/gu;

/** True when most letters are CJK. InkOS books are often Chinese, and Harper only knows English. */
export function isMostlyCjk(text: string): boolean {
  const cjk = text.match(CJK)?.length ?? 0;
  return cjk > 0 && cjk >= (text.match(LATIN)?.length ?? 0);
}

const normalizeWord = (word: string) => word.toLowerCase().replace(/['’]s?$/u, "");

const kebab = (kind: string) => kind.replace(/(?<=[a-z])(?=[A-Z])/gu, "-").toLowerCase();

/**
 * Harper documents its spans as character indices. In current builds they arrive
 * as UTF-16 offsets, but if the quoted text does not line up, treat them as code
 * points and convert, so `text.slice(start, end)` is always the flagged text.
 */
function utf16Span(text: string, lint: Lint): [number, number] {
  const span = lint.span();
  const problem = lint.get_problem_text();
  if (text.slice(span.start, span.end) === problem) return [span.start, span.end];
  const points = [...text];
  const offset = (index: number) => points.slice(0, index).join("").length;
  return [offset(span.start), offset(span.end)];
}

function fixes(lint: Lint, problem: string): Diagnostic["fixes"] {
  return lint.suggestions().map((suggestion) => {
    const text = suggestion.get_replacement_text();
    switch (suggestion.kind()) {
      case SuggestionKind.Remove: return { title: `Remove "${problem}"`, replacement: "" };
      // Fixes replace the range, so an insertion keeps the flagged text in front.
      case SuggestionKind.InsertAfter: return { title: `Insert "${text}"`, replacement: problem + text };
      default: return { title: `Replace with "${text}"`, replacement: text };
    }
  });
}

/**
 * Lint `document.text.slice(start, end)` and return diagnostics with ranges in
 * the whole document. The editor uses this to re-lint only the paragraphs a
 * keystroke touched (a paragraph takes a few milliseconds; a 10k-word chapter
 * a few hundred).
 */
export async function lintRange(
  context: TextRuleContext,
  start: number,
  end: number,
  options: HarperRuleOptions = {},
): Promise<Diagnostic[]> {
  const { document } = context;
  const text = document.text.slice(start, end);
  // Judged on the whole document so a Chinese chapter's stray English line is skipped too.
  if (!text.trim() || isMostlyCjk(document.text)) return [];

  const dictionary = [...new Set(context.dictionary ?? [])].sort();
  const accepted = new Set(dictionary.map(normalizeWord));
  const handle = await harperLinter(options.dialect);
  const lints = await serialize(handle, async () => {
    const key = dictionary.join("\n");
    if (key !== handle.wordsKey) {
      await handle.linter.clearWords();
      if (dictionary.length) await handle.linter.importWords(dictionary);
      handle.wordsKey = key;
    }
    return handle.linter.lint(text, { language: options.language ?? "markdown" });
  });

  const diagnostics: Diagnostic[] = [];
  for (const lint of lints) {
    const kind = lint.lint_kind();
    const problem = lint.get_problem_text();
    // The user dictionary misses forms like possessives ("Zorbak's"), so check again here.
    if (kind === "Spelling" && accepted.has(normalizeWord(problem))) continue;
    const [from, to] = utf16Span(text, lint);
    diagnostics.push(textDiagnostic({
      rule: RULE,
      document,
      start: start + from,
      end: start + to,
      summary: lint.message(),
      severity: NOTE_KINDS.has(kind) ? "note" : "warning",
      code: kebab(kind),
      fixes: fixes(lint, problem),
    }));
  }
  return diagnostics;
}

/** Paragraph spans (`[start, end)`, separated by blank lines, outer whitespace trimmed), for per-paragraph re-linting. */
export function paragraphRanges(text: string): Array<[number, number]> {
  return [...text.matchAll(/\S(?:[^\n]|\n(?![ \t]*\n))*/gu)].map((match) => [match.index, match.index + match[0].trimEnd().length]);
}

/** Lint the given paragraphs (default: all of them) one by one, with document-wide ranges. */
export async function checkParagraphs(
  context: TextRuleContext,
  ranges: ReadonlyArray<readonly [number, number]> = paragraphRanges(context.document.text),
  options: HarperRuleOptions = {},
): Promise<Diagnostic[]> {
  const results = await Promise.all(ranges.map(([start, end]) => lintRange(context, start, end, options)));
  return results.flat();
}

/** Harper (https://writewithharper.com, Apache-2.0) as the L0 `mechanics/harper` text rule. */
export function createHarperRule(options: HarperRuleOptions = {}): TextRule {
  return {
    ...RULE,
    rationale: RATIONALE,
    check: (context) => lintRange(context, 0, context.document.text.length, options),
  };
}

export const harperRule = createHarperRule();
