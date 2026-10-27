import type { DiagnosticConfidence } from "@plotlint/diagnostics";
import type { DiagnosticEntry } from "./plugin.js";

const confidenceLabels: Record<DiagnosticConfidence, string> = {
  deterministic: "Deterministic: proved by code",
  extracted: "Extracted: code checked facts a model extracted",
  judged: "Judged: a model or rubric opinion",
};

/** The label shown next to a finding so the writer knows how sure it is. */
export function confidenceLabel(confidence: DiagnosticConfidence): string {
  return confidenceLabels[confidence] ?? confidence;
}

export interface DetailsOptions {
  /** Called when the writer picks a quick fix. */
  readonly onFix?: (entry: DiagnosticEntry, fixIndex: number) => void;
  readonly document?: Document;
}

/**
 * A minimal, unstyled-by-default tooltip body for the diagnostics under the mouse
 * or cursor: message, rule, confidence, evidence and fixes. Studio may render its
 * own instead from the same entries. Text is set with textContent, never as HTML.
 */
export function renderDiagnosticDetails(entries: ReadonlyArray<DiagnosticEntry>, options: DetailsOptions = {}): HTMLElement {
  const doc = options.document ?? document;
  const element = (tag: string, className: string, text?: string): HTMLElement => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const root = element("div", "pl-diag-details");
  for (const entry of entries) {
    const { diagnostic } = entry;
    const item = element("section", `pl-diag-details__item pl-diag--${diagnostic.layer} pl-diag--${diagnostic.severity}`);
    item.dataset.diagnosticId = entry.id;

    const header = element("header", "pl-diag-details__header");
    header.append(
      element("span", "pl-diag-details__severity", diagnostic.severity),
      element("code", "pl-diag-details__rule", diagnostic.ruleId),
      element("span", `pl-diag-details__confidence pl-diag-details__confidence--${diagnostic.confidence}`, confidenceLabel(diagnostic.confidence)),
    );
    item.append(header, element("p", "pl-diag-details__message", diagnostic.summary));

    if (diagnostic.evidence.length) {
      const evidence = element("ul", "pl-diag-details__evidence");
      for (const line of diagnostic.evidence) evidence.append(element("li", "", line));
      item.append(evidence);
    }
    if (entry.stale) {
      item.append(element("p", "pl-diag-details__stale", "Text changed since this check; it will update on the next lint."));
    } else if (diagnostic.fixes?.length) {
      const fixes = element("div", "pl-diag-details__fixes");
      diagnostic.fixes.forEach((fix, index) => {
        const button = element("button", "pl-diag-details__fix", fix.title) as HTMLButtonElement;
        button.type = "button";
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => options.onFix?.(entry, index));
        fixes.append(button);
      });
      item.append(fixes);
    }
    root.append(item);
  }
  return root;
}
