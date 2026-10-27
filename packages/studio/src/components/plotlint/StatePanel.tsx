import { useMemo, useState } from "react";
import { CircleDashed, Loader2 } from "lucide-react";
import type { TFunction } from "../../hooks/use-i18n";
import { cn } from "../../lib/utils";
import type { EntityAtCursor, EvidenceLocation } from "./navigate-client";

export interface StatePanelProps {
  /** The world as of the cursor, grouped by entity; null before the first answer. */
  readonly entities: ReadonlyArray<EntityAtCursor> | null;
  /** The chapter the cursor is in. */
  readonly chapter: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly stateMissing: boolean;
  readonly t: TFunction;
  /** Jump to the passage that established a fact. */
  readonly onOpen: (location: EvidenceLocation) => void;
  readonly className?: string;
}

/** Rows drawn at once; narrow a big cast with the filter. */
const MAX_FACTS = 400;

/** A debugger-style inspector: every fact that holds at the cursor, with where it was established. */
export function StatePanel({ entities, chapter, loading, error, stateMissing, t, onOpen, className }: StatePanelProps) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!entities || !needle) return entities ?? [];
    return entities
      .map((entity) => entity.subject.toLowerCase().includes(needle)
        ? entity
        : { ...entity, facts: entity.facts.filter(({ fact }) => `${fact.predicate} ${fact.object}`.toLowerCase().includes(needle)) })
      .filter((entity) => entity.facts.length > 0);
  }, [entities, filter]);
  let budget = MAX_FACTS;

  return (
    <section className={cn("rounded-2xl border border-border/50 bg-card/60 shadow-sm", className)} aria-label={t("state.title")} data-testid="state-panel">
      <header className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{t("state.title")}</h2>
        <span className="text-xs text-muted-foreground">ch{chapter}</span>
        {loading && <Loader2 size={12} className="animate-spin text-muted-foreground" aria-label={t("problems.checking")} />}
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("state.filter")}
          aria-label={t("state.filter")}
          className="ml-auto h-7 w-28 rounded-lg border border-border/50 bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </header>
      {error && <p className="border-b border-border/30 px-4 py-1.5 text-xs text-destructive" title={error}>{t("problems.failed")}: {error}</p>}
      {stateMissing && <p className="px-4 py-3 text-xs text-muted-foreground">{t("state.noState")}</p>}
      {!stateMissing && entities && visible.length === 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">{entities.length === 0 ? t("state.none") : t("problems.noMatch")}</p>
      )}
      <div className="space-y-3 px-4 py-3 text-sm">
        {visible.map((entity) => {
          if (budget <= 0) return null;
          const facts = entity.facts.slice(0, budget);
          budget -= facts.length;
          return (
            <div key={entity.subject} data-entity={entity.subject}>
              <h3 className="mb-1 text-xs font-semibold text-foreground">{entity.subject}</h3>
              <ul className="space-y-0.5">
                {facts.map(({ fact, kind, established, unanchored }, index) => (
                  <li
                    key={`${fact.predicate}:${fact.object}:${index}`}
                    data-kind={kind}
                    className={cn("flex items-baseline gap-1.5 text-xs", unanchored && "opacity-70")}
                    title={unanchored ? t("state.unanchored") : undefined}
                  >
                    <span className={cn("pl-fact-kind shrink-0 rounded px-1 text-[9px] font-medium uppercase tracking-wide", `pl-fact-kind--${kind}`)}>{kind.replace("_", " ")}</span>
                    <span className="min-w-0 flex-1 break-words">
                      <span className="text-muted-foreground">{fact.predicate}</span>
                      <span className="mx-1 text-muted-foreground/60">→</span>
                      <span className="text-foreground">{fact.object}</span>
                    </span>
                    {unanchored && <CircleDashed size={10} className="shrink-0 self-center text-muted-foreground" aria-label={t("state.unanchored")} data-testid="state-unanchored" />}
                    {established ? (
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onOpen(established)}
                        title={`${t("state.established")} ch${established.chapter}: “${established.quote}”`}
                        className="shrink-0 tabular-nums text-[11px] text-primary hover:underline"
                        data-testid="state-established"
                      >
                        {t("state.established")} ch{established.chapter}
                      </button>
                    ) : (
                      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/70" title={t("state.noEvidence")}>ch{fact.sourceChapter}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
