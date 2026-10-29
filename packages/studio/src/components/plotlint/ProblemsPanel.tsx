import { useMemo, useState } from "react";
import { AlertTriangle, CircleAlert, CornerDownRight, EyeOff, Info, Loader2, ThumbsDown } from "lucide-react";
import type { DiagnosticSeverity } from "@plotlint/diagnostics";
import type { TFunction } from "../../hooks/use-i18n";
import { cn } from "../../lib/utils";
import { sceneIdsIn } from "./writing-model";
import {
  ALL_PROBLEMS,
  CONFIDENCE_ORDER,
  LAYER_ORDER,
  SEVERITY_ORDER,
  countBy,
  rowTarget,
  visibleProblems,
  type ProblemFilter,
  type ProblemRow,
  type ProblemSort,
} from "./problems-model";

export interface ProblemsPanelProps {
  readonly rows: ReadonlyArray<ProblemRow>;
  readonly suppressed: number;
  readonly linting: boolean;
  readonly error: string | null;
  readonly stateMissing: boolean;
  readonly t: TFunction;
  /** Called for a row with somewhere to go (see `rowTarget`): its text, or where its fact was established. */
  readonly onSelect?: (row: ProblemRow) => void;
  /** Called to mark a finding as intentional. */
  readonly onSuppress?: (row: ProblemRow) => void;
  /** Called for "Not useful": hide the finding this session and record the rejection. */
  readonly onNotUseful?: (row: ProblemRow) => void;
  readonly initialFilter?: ProblemFilter;
  readonly initialSort?: ProblemSort;
}

const severityIcon: Record<DiagnosticSeverity, typeof CircleAlert> = {
  error: CircleAlert,
  warning: AlertTriangle,
  note: Info,
};

const severityClass: Record<DiagnosticSeverity, string> = {
  error: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
  note: "text-muted-foreground",
};

/** Rows drawn at once; a long chapter can have thousands of findings, so narrow with the filters. */
const MAX_ROWS = 300;

const selectClass = "h-7 rounded-lg border border-border/50 bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20";

/** The bottom problems list for the open chapter, like an IDE's problems view. */
export function ProblemsPanel({ rows, suppressed, linting, error, stateMissing, t, onSelect, onSuppress, onNotUseful, initialFilter, initialSort }: ProblemsPanelProps) {
  const [filter, setFilter] = useState<ProblemFilter>(initialFilter ?? ALL_PROBLEMS);
  const [sort, setSort] = useState<ProblemSort>(initialSort ?? "position");
  const visible = useMemo(() => visibleProblems(rows, filter, sort), [rows, filter, sort]);
  const layers = useMemo(() => countBy(rows, "layer"), [rows]);
  const severities = useMemo(() => countBy(rows, "severity"), [rows]);
  const confidences = useMemo(() => countBy(rows, "confidence"), [rows]);

  return (
    <section className="rounded-2xl border border-border/50 bg-card/60 shadow-sm" aria-label={t("problems.title")} data-testid="problems-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/40 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{t("problems.title")}</h2>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground" data-testid="problems-count">{rows.length}</span>
        {suppressed > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="problems-suppressed">
            <EyeOff size={12} />
            {suppressed} {t("problems.suppressed")}
          </span>
        )}
        {linting && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            {t("problems.checking")}
          </span>
        )}
        {error && <span className="text-xs text-destructive" title={error}>{t("problems.failed")}: {error}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select aria-label={t("problems.allLayers")} className={selectClass} value={filter.layer}
            onChange={(event) => setFilter({ ...filter, layer: event.target.value as ProblemFilter["layer"] })}>
            <option value="all">{t("problems.allLayers")}</option>
            {LAYER_ORDER.map((layer) => (
              <option key={layer} value={layer}>{layer} ({layers.get(layer) ?? 0})</option>
            ))}
          </select>
          <select aria-label={t("problems.allSeverities")} className={selectClass} value={filter.severity}
            onChange={(event) => setFilter({ ...filter, severity: event.target.value as ProblemFilter["severity"] })}>
            <option value="all">{t("problems.allSeverities")}</option>
            {SEVERITY_ORDER.filter((severity) => severities.has(severity) || filter.severity === severity).map((severity) => (
              <option key={severity} value={severity}>{severity} ({severities.get(severity) ?? 0})</option>
            ))}
          </select>
          <select aria-label={t("problems.allConfidences")} className={selectClass} value={filter.confidence}
            onChange={(event) => setFilter({ ...filter, confidence: event.target.value as ProblemFilter["confidence"] })}>
            <option value="all">{t("problems.allConfidences")}</option>
            {CONFIDENCE_ORDER.filter((confidence) => confidences.has(confidence) || filter.confidence === confidence).map((confidence) => (
              <option key={confidence} value={confidence}>{confidence} ({confidences.get(confidence) ?? 0})</option>
            ))}
          </select>
          <select aria-label={t("problems.sortPosition")} className={selectClass} value={sort}
            onChange={(event) => setSort(event.target.value as ProblemSort)}>
            <option value="position">{t("problems.sortPosition")}</option>
            <option value="severity">{t("problems.sortSeverity")}</option>
            <option value="layer">{t("problems.sortLayer")}</option>
            <option value="confidence">{t("problems.sortConfidence")}</option>
          </select>
        </div>
      </header>
      {stateMissing && <p className="border-b border-border/30 px-4 py-1.5 text-xs text-muted-foreground">{t("problems.noState")}</p>}
      <ul className="max-h-64 overflow-y-auto py-1 text-sm">
        {visible.length === 0 && (
          <li className="px-4 py-3 text-xs text-muted-foreground">{rows.length === 0 ? t("problems.none") : t("problems.noMatch")}</li>
        )}
        {visible.slice(0, MAX_ROWS).map((row) => {
          const { diagnostic } = row;
          const Icon = severityIcon[diagnostic.severity];
          const target = rowTarget(row);
          const clickable = target !== null && onSelect !== undefined;
          return (
            <li key={row.key} data-scenes={sceneIdsIn(diagnostic).join(" ") || undefined} data-rule-id={diagnostic.ruleId} data-layer={diagnostic.layer} data-ranged={row.entryId !== null} className="group flex items-start">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onSelect!(row)}
                className={cn(
                  "flex min-w-0 flex-1 items-start gap-2 px-4 py-1.5 text-left transition-colors",
                  clickable ? "hover:bg-secondary/60 cursor-pointer" : "cursor-default",
                  row.stale && "opacity-60",
                )}
              >
                <Icon size={14} className={cn("mt-0.5 shrink-0", severityClass[diagnostic.severity])} aria-label={diagnostic.severity} />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">{diagnostic.summary}</span>
                  {diagnostic.evidence[0] && <span className="ml-2 text-muted-foreground">{diagnostic.evidence[0]}</span>}
                  {row.established && (
                    <span
                      className="ml-2 inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] text-primary"
                      title={`${t("state.established")} ch${row.established.chapter}: “${row.established.quote}”`}
                      data-testid="problem-established"
                    >
                      <CornerDownRight size={11} />
                      {t("state.established")} ch{row.established.chapter}
                    </span>
                  )}
                </span>
                <code className="shrink-0 text-[11px] text-muted-foreground">{diagnostic.ruleId}</code>
                <span className={cn("pl-problem-layer shrink-0 rounded px-1.5 text-[10px] font-medium uppercase tracking-wide", `pl-problem-layer--${diagnostic.layer}`)}>
                  {diagnostic.layer}
                </span>
                <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {row.line === null ? t("problems.wholeChapter") : `${t("problems.line")} ${row.line}`}
                </span>
              </button>
              {onSuppress && (
                <button
                  type="button"
                  title={t("problems.markIntentional")}
                  aria-label={t("problems.markIntentional")}
                  onClick={() => onSuppress(row)}
                  className="mr-2 mt-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                >
                  <EyeOff size={12} />
                </button>
              )}
              {onNotUseful && (
                <button
                  type="button"
                  title={t("problems.notUsefulHint")}
                  aria-label={t("problems.notUseful")}
                  onClick={() => onNotUseful(row)}
                  className="mr-2 mt-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  data-testid="problem-not-useful"
                >
                  <ThumbsDown size={12} />
                </button>
              )}
            </li>
          );
        })}
        {visible.length > MAX_ROWS && (
          <li className="px-4 py-2 text-xs text-muted-foreground">+{visible.length - MAX_ROWS}</li>
        )}
      </ul>
    </section>
  );
}
