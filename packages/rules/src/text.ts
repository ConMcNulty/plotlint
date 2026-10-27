import type { RuntimeStateSnapshot } from "@actalk/inkos-core";
import { DiagnosticSchema, type Diagnostic, type DiagnosticLayer } from "@plotlint/diagnostics";

/** A piece of manuscript text checked as one unit, usually a chapter. */
export interface TextDocument {
  /** Stable id for the source, e.g. `chapter:12`; diagnostics carry it in `range.sourceId`. */
  readonly sourceId: string;
  readonly chapter?: number;
  readonly text: string;
}

export interface TextRuleContext {
  readonly document: TextDocument;
  /** Story state, when known, so text rules can read names, places and other facts. */
  readonly snapshot?: RuntimeStateSnapshot;
  /** Words the project accepts as spelled correctly (character names, invented terms). */
  readonly dictionary?: ReadonlyArray<string>;
}

/**
 * A rule over manuscript text (L0 mechanics, L1 style, L2 metrics). Unlike state
 * rules, text rules may be async because some wrap WebAssembly or external checkers.
 */
export interface TextRule {
  /** `<layer>/<name>`, stable across releases so suppressions keep working. */
  readonly id: string;
  readonly layer: DiagnosticLayer;
  /** Why the rule matters, shown on hover. */
  readonly rationale: string;
  check(context: TextRuleContext): Diagnostic[] | Promise<Diagnostic[]>;
}

/**
 * Run text rules over one document. Every finding must carry a range inside the
 * document, since text diagnostics are drawn as underlines.
 */
export async function checkText(
  document: TextDocument,
  rules: ReadonlyArray<TextRule>,
  options: Omit<TextRuleContext, "document"> = {},
): Promise<Diagnostic[]> {
  const context: TextRuleContext = { ...options, document };
  const results = await Promise.all(rules.map((rule) => rule.check(context)));
  const diagnostics = results.flat().map((diagnostic) => {
    const parsed = DiagnosticSchema.parse(diagnostic);
    const range = parsed.range;
    if (!range || range.sourceId !== document.sourceId || range.end > document.text.length) {
      throw new Error(`text rule ${parsed.ruleId} emitted a diagnostic without a valid range in ${document.sourceId}`);
    }
    return parsed;
  });
  // Text findings read top to bottom, like a compiler's output for one file.
  return diagnostics.sort((a, b) => a.range!.start - b.range!.start || a.range!.end - b.range!.end || a.ruleId.localeCompare(b.ruleId));
}

export interface TextFindingInput {
  readonly rule: Pick<TextRule, "id" | "layer">;
  readonly document: TextDocument;
  readonly start: number;
  readonly end: number;
  readonly summary: string;
  readonly severity?: Diagnostic["severity"];
  readonly code?: string;
  /** Extra evidence lines after the quoted span. */
  readonly evidence?: ReadonlyArray<string>;
  readonly fixes?: Diagnostic["fixes"];
}

/** Build a deterministic text diagnostic whose evidence quotes the flagged span. */
export function textDiagnostic(input: TextFindingInput): Diagnostic {
  const { rule, document, start, end } = input;
  const quote = document.text.slice(start, end);
  return {
    code: input.code ?? rule.id.split("/").pop() ?? rule.id,
    ruleId: rule.id,
    layer: rule.layer,
    severity: input.severity ?? "warning",
    confidence: "deterministic",
    category: "quality",
    assessment: "issue",
    ...(document.chapter === undefined ? {} : { chapter: document.chapter }),
    summary: input.summary,
    evidence: [`"${quote}"`, ...(input.evidence ?? [])],
    range: { sourceId: document.sourceId, start, end },
    ...(quote ? { sourceRefs: [{ sourceId: document.sourceId, quote }] } : {}),
    ...(input.fixes?.length ? { fixes: [...input.fixes] } : {}),
  };
}
