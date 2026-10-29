import { X } from "lucide-react";
import type { TFunction } from "../../hooks/use-i18n";
import { cn } from "../../lib/utils";
import type { EvidenceLocation, References } from "./navigate-client";

export interface ReferencesPanelProps {
  readonly references: References;
  /** The open chapter, marked in the list. */
  readonly chapter: number;
  readonly t: TFunction;
  readonly onOpen: (location: EvidenceLocation) => void;
  readonly onClose: () => void;
  readonly className?: string;
}

/** Find all references (Shift+F12): every appearance of an entity, grouped by chapter. */
export function ReferencesPanel({ references, chapter, t, onOpen, onClose, className }: ReferencesPanelProps) {
  return (
    <section className={cn("rounded-2xl border border-border/50 bg-card/60 shadow-sm", className)} aria-label={t("refs.title")} data-testid="references-panel">
      <header className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
        <h3 className="text-sm font-semibold">{t("refs.title")}: {references.entity}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {references.total} · {references.groups.length} {t("refs.chapters")}
        </span>
        {references.names.length > 1 && <span className="text-xs text-muted-foreground truncate">({references.names.join(", ")})</span>}
        <button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" aria-label={t("refs.close")}>
          <X size={14} />
        </button>
      </header>
      <div className="max-h-80 overflow-y-auto px-4 py-2 space-y-3 text-sm">
        {references.groups.map((group) => (
          <div key={group.chapter}>
            <div className={cn("text-xs font-medium mb-1", group.chapter === chapter ? "text-primary" : "text-muted-foreground")}>
              ch{group.chapter} ({group.hits.length})
            </div>
            <ul className="space-y-0.5">
              {group.hits.map((hit) => (
                <li key={hit.start}>
                  <button
                    type="button"
                    onClick={() => onOpen({ chapter: group.chapter, start: hit.start, end: hit.end, quote: hit.text })}
                    className="w-full text-left rounded px-1 hover:bg-secondary/50"
                    data-testid="reference-hit"
                  >
                    <span className="text-xs text-muted-foreground tabular-nums mr-2">{hit.line}</span>
                    {hit.context}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
