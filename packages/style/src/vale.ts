import { load } from "js-yaml";
import type { Diagnostic } from "@plotlint/diagnostics";
import { textDiagnostic, type TextDocument, type TextRule } from "@plotlint/rules";

/*
 * A TypeScript engine for a subset of Vale's YAML rule format (https://vale.sh/docs/topics/styles/).
 * Vale is a Go binary and can't run per keystroke in the editor, so this core stays free of
 * Node APIs and takes YAML as strings; file loading lives in `./node.ts`.
 *
 * Supported: `existence`, `substitution` and `occurrence`, with `message` (`%s`), `level`,
 * `link`, `ignorecase`, `nonword`, `raw`, `exceptions` and `description` (used as the rationale).
 * Regexes are JavaScript regexes, not Go RE2: a leading `(?i)` is honoured, lookarounds work
 * here but not in Vale. `scope` is ignored for existence and substitution, since plotlint
 * checks plain manuscript text rather than markup.
 *
 * plotlint extension, ignored by Vale: `plotlint: { skipDialogue: true }` drops matches that
 * start inside double-quoted dialogue, for rules (filter words, intensifiers) that target
 * narration and would nag about how characters talk.
 */

export class StyleLoadError extends Error {
  constructor(readonly problems: ReadonlyArray<{ readonly source: string; readonly message: string }>) {
    super(`could not load style rules:\n${problems.map((p) => `  ${p.source}: ${p.message}`).join("\n")}`);
    this.name = "StyleLoadError";
  }
}

/**
 * Parse Vale YAML rules, keyed by path, into text rules. A key `General/FilterWords.yml`
 * gives the id `style/General.FilterWords` (Vale's `Style.Rule` name, so suppressions read
 * like Vale's); a key without a folder gives `style/<file name>`. Every bad rule is collected
 * and thrown together, so a pack never loads half its rules silently.
 */
export function loadStyleRules(yamlSources: Readonly<Record<string, string>>): TextRule[] {
  const rules: TextRule[] = [];
  const problems: { source: string; message: string }[] = [];
  for (const [source, yaml] of Object.entries(yamlSources)) {
    try {
      rules.push(compileRule(styleRuleId(source), load(yaml)));
    } catch (error) {
      problems.push({ source, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (problems.length) throw new StyleLoadError(problems);
  return rules;
}

export function styleRuleId(source: string): string {
  const parts = source.replace(/\\/g, "/").replace(/\.ya?ml$/i, "").split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error("empty rule name");
  const style = parts.pop();
  return `style/${style ? `${style}.${name}` : name}`;
}

const severityByLevel: Record<string, Diagnostic["severity"]> = { error: "error", warning: "warning", suggestion: "note" };
const unsupportedTypes = new Set(["repetition", "consistency", "conditional", "capitalization", "spelling", "metric", "sequence", "readability", "script"]);
const scopes = new Set(["text", "paragraph", "sentence"]);

type Spec = Record<string, unknown>;
interface Match { readonly start: number; readonly end: number; readonly text: string }

interface Common {
  readonly id: string;
  readonly severity: Diagnostic["severity"];
  readonly message: string;
  readonly evidence: string[];
  readonly ignorecase: boolean;
  readonly skipDialogue: boolean;
}

function compileRule(id: string, spec: unknown): TextRule {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("rule must be a YAML mapping");
  const s = spec as Spec;
  const type = s.extends;
  if (typeof type !== "string") throw new Error("missing `extends` (the rule type)");
  if (unsupportedTypes.has(type)) throw new Error(`Vale rule type \`${type}\` is not supported yet`);
  const level = optional(s, "level", "string") ?? "suggestion"; // Vale's default level
  const severity = severityByLevel[level];
  if (!severity) throw new Error(`unknown level \`${level}\` (expected error, warning or suggestion)`);
  const message = optional(s, "message", "string") ?? `Avoid '%s'.`;
  const link = optional(s, "link", "string");
  const description = optional(s, "description", "string");
  const common: Common = {
    id, severity, message,
    evidence: link ? [`See ${link}`] : [],
    ignorecase: optional(s, "ignorecase", "boolean") ?? false,
    skipDialogue: plotlintOptions(s.plotlint).skipDialogue,
  };
  const rationale = [description ?? message.replace(/%s/g, "…"), link].filter(Boolean).join(" ");
  const base = { id, layer: "style" as const, rationale };
  switch (type) {
    case "existence": return { ...base, check: existence(common, s) };
    case "substitution": return { ...base, check: substitution(common, s) };
    case "occurrence": return { ...base, check: occurrence(common, s) };
    default: throw new Error(`unknown Vale rule type \`${type}\``);
  }
}

type Check = TextRule["check"];

function existence(c: Common, s: Spec): Check {
  const tokens = stringList(s, "tokens");
  const raw = stringList(s, "raw");
  if (!tokens.length && !raw.length) throw new Error("existence rule needs `tokens` or `raw`");
  const nonword = optional(s, "nonword", "boolean") ?? false;
  // As in Vale, `raw` pieces are joined verbatim with no word boundaries.
  const alternatives = [...(tokens.length ? [wrap(tokens.join("|"), nonword)] : []), ...(raw.length ? [raw.join("")] : [])];
  const regex = compile(alternatives.join("|"), c.ignorecase);
  // Vale exceptions are regexes that must match the whole flagged text.
  const exceptions = stringList(s, "exceptions").map((e) => new RegExp(`^(?:${e})$`, c.ignorecase ? "i" : ""));
  return ({ document }) => findAll(regex, document, c.skipDialogue)
    .filter((m) => !exceptions.some((e) => e.test(m.text)))
    .map((m) => finding(c, document, m, format(c.message, [m.text])));
}

function substitution(c: Common, s: Spec): Check {
  const swap = s.swap;
  if (!swap || typeof swap !== "object" || Array.isArray(swap) || !Object.keys(swap).length) throw new Error("substitution rule needs a `swap` mapping");
  const nonword = optional(s, "nonword", "boolean") ?? false;
  const entries = Object.entries(swap as Spec).map(([pattern, value]) => {
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`swap value for \`${pattern}\` must be a string`);
    // `a|b` on the right offers several replacements, as in Vale.
    return { regex: compile(wrap(pattern, nonword), c.ignorecase), replacements: String(value).split("|").map((r) => r.trim()).filter(Boolean) };
  });
  return ({ document }) => {
    const hits = entries.flatMap(({ regex, replacements }) => findAll(regex, document, c.skipDialogue).map((m) => ({ ...m, replacements })))
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const diagnostics: Diagnostic[] = [];
    let covered = 0;
    for (const hit of hits) {
      // Overlapping keys: keep the earliest, longest match, so one span gets one finding.
      if (hit.start < covered) continue;
      // Vale stays quiet when the text already reads as the replacement.
      if (hit.replacements.some((r) => r.toLowerCase() === hit.text.toLowerCase())) continue;
      covered = hit.end;
      const fixes = hit.replacements.map((r) => ({ title: `Replace with "${matchCase(hit.text, r)}"`, replacement: matchCase(hit.text, r) }));
      diagnostics.push(finding(c, document, hit, format(c.message, [hit.replacements.join("' or '"), hit.text]), fixes));
    }
    return diagnostics;
  };
}

function occurrence(c: Common, s: Spec): Check {
  const token = optional(s, "token", "string");
  if (!token) throw new Error("occurrence rule needs a `token`");
  const max = optional(s, "max", "number");
  const min = optional(s, "min", "number");
  if (max === undefined && min === undefined) throw new Error("occurrence rule needs `max` or `min`");
  const scope = optional(s, "scope", "string") ?? "text";
  if (!scopes.has(scope)) throw new Error(`occurrence scope \`${scope}\` is not supported (use text, paragraph or sentence)`);
  const regex = compile(token, c.ignorecase);
  return ({ document }) => {
    const matches = findAll(regex, document, c.skipDialogue);
    const diagnostics: Diagnostic[] = [];
    for (const [start, end] of segments(document.text, scope)) {
      if (start === end) continue;
      const inside = matches.filter((m) => m.start >= start && m.end <= end);
      if (max !== undefined && inside.length > max) {
        // Underline from the first to the last hit: precise, and still one finding per scope.
        const span = { start: inside[0]!.start, end: inside.at(-1)!.end, text: "" };
        diagnostics.push(finding(c, document, span, format(c.message, [String(inside.length)]), undefined, [`${inside.length} matches (max ${max}): ${inside.map((m) => m.text).join(", ")}`]));
      } else if (min !== undefined && inside.length < min) {
        diagnostics.push(finding(c, document, { start, end, text: "" }, format(c.message, [String(inside.length)]), undefined, [`${inside.length} matches (min ${min})`]));
      }
    }
    return diagnostics;
  };
}

function finding(c: Common, document: TextDocument, m: Match, summary: string, fixes?: Diagnostic["fixes"], extra: string[] = []): Diagnostic {
  return textDiagnostic({
    rule: { id: c.id, layer: "style" }, document, start: m.start, end: m.end,
    summary, severity: c.severity, evidence: [...extra, ...c.evidence], ...(fixes ? { fixes } : {}),
  });
}

function findAll(regex: RegExp, document: TextDocument, skipDialogue: boolean): Match[] {
  const dialogue = skipDialogue ? dialogueSpans(document.text) : [];
  const matches: Match[] = [];
  for (const m of document.text.matchAll(regex)) {
    if (!m[0]) continue; // an empty match has nothing to underline
    const start = m.index!;
    if (dialogue.some(([from, to]) => start >= from && start < to)) continue;
    matches.push({ start, end: start + m[0].length, text: m[0] });
  }
  return matches;
}

/**
 * Double-quoted spans, straight or curly. A quote left open runs to the end of its line,
 * since multi-paragraph speech leaves each paragraph's quote unclosed.
 */
export function dialogueSpans(text: string): Array<[number, number]> {
  return [...text.matchAll(/“[^”\n]*(?:”|$)|"[^"\n]*(?:"|$)/gm)].map((m) => [m.index!, m.index! + m[0].length]);
}

/** Paragraphs split on blank lines; sentences end at terminal punctuation (Latin or CJK) or a line break. */
export function segments(text: string, scope: string): Array<[number, number]> {
  if (scope === "text") return [[0, text.length]];
  const pattern = scope === "paragraph" ? /\S(?:[^\n]|\n(?!\s*\n))*/g : /[^\s][^.!?。！？\n]*(?:[.!?。！？]+["'”’)\]]*)?/g;
  return [...text.matchAll(pattern)].map((m) => [m.index!, m.index! + m[0].trimEnd().length]);
}

function wrap(pattern: string, nonword: boolean): string {
  return nonword ? pattern : `\\b(?:${pattern})\\b`;
}

function compile(pattern: string, ignorecase: boolean): RegExp {
  // Go's inline flag is common in Vale styles; JavaScript only takes flags outside the pattern.
  const inline = /^\(\?i\)/.test(pattern);
  const source = inline ? pattern.slice(4) : pattern;
  try {
    return new RegExp(source, ignorecase || inline ? "gi" : "g");
  } catch (error) {
    throw new Error(`bad regex ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Vale-style `%s` interpolation, in order; `%%` is a literal percent sign. */
export function format(message: string, args: ReadonlyArray<string>): string {
  let i = 0;
  return message.replace(/%[s%]/g, (token) => (token === "%%" ? "%" : args[i++] ?? ""));
}

function matchCase(original: string, replacement: string): string {
  return /^[A-Z]/.test(original) && /^[a-z]/.test(replacement) ? replacement[0]!.toUpperCase() + replacement.slice(1) : replacement;
}

function plotlintOptions(value: unknown): { skipDialogue: boolean } {
  if (value === undefined) return { skipDialogue: false };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("`plotlint` must be a mapping");
  const unknown = Object.keys(value).filter((key) => key !== "skipDialogue");
  if (unknown.length) throw new Error(`unknown plotlint option(s): ${unknown.join(", ")}`);
  return { skipDialogue: optional(value as Spec, "skipDialogue", "boolean") ?? false };
}

function optional<T extends "string" | "boolean" | "number">(s: Spec, key: string, type: T): (T extends "string" ? string : T extends "boolean" ? boolean : number) | undefined {
  const value = s[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== type) throw new Error(`\`${key}\` must be a ${type}`);
  return value as never;
}

function stringList(s: Spec, key: string): string[] {
  const value = s[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new Error(`\`${key}\` must be a list of strings`);
  return value as string[];
}
