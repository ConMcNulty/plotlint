import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

// Views beyond the page (PLAN): the hook board (open promises and how long the reader
// has waited), the timeline (story time with the continuity findings that break it),
// the cast board (who stands where at the end, and how they relate) and the tension
// curve (judged stakes per chapter). Every card opens its chapter.

interface Finding {
  readonly ruleId: string;
  readonly severity: "error" | "warning" | "note";
  readonly summary: string;
  readonly chapter?: number;
}

interface HookCard {
  readonly id: string;
  readonly promise: string;
  readonly opened: number;
  readonly lastAdvanced: number;
  readonly column: "open" | "resolved" | "dropped";
  readonly age: number | null;
  readonly offPage: boolean;
  readonly resolvedIn?: number;
  readonly findings: Finding[];
}

interface Mark { readonly label: string }

interface TimelineChapter {
  readonly chapter: number;
  readonly at: number | null;
  readonly basis: "date" | "elapsed" | "unknown";
  readonly looksBack: boolean;
  readonly dates: Mark[];
  readonly markers: Mark[];
  readonly conflicts: Finding[];
}

interface CastMember {
  readonly name: string;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly status: string | null;
  readonly location: string | null;
  readonly povChapters: number[];
  readonly relations: ReadonlyArray<{ predicate: string; object: string; with: string | null; since: number }>;
  readonly findings: Finding[];
}

interface TensionPoint { readonly chapter: number; readonly stakes: number; readonly scene: string; readonly pov: string | null; readonly goal: string | null }

interface BoardsData {
  readonly stateMissing: boolean;
  readonly hooks: { readonly end: number; readonly cards: HookCard[]; readonly openPerChapter: number[] } | null;
  readonly timeline: { readonly chapters: TimelineChapter[]; readonly unplaced: Finding[] } | null;
  readonly cast: CastMember[] | null;
  readonly tension: { readonly points: TensionPoint[]; readonly findings: Finding[] } | null;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
  toChapter: (bookId: string, chapter: number) => void;
}

const COLUMNS = ["open", "resolved", "dropped"] as const;

/** Elapsed story time between two points, in the largest unit that reads well. */
export function formatGap(hours: number): string {
  if (hours < 48) return `+${Math.round(hours)}h`;
  if (hours < 24 * 60) return `+${Math.round(hours / 24)}d`;
  if (hours < 24 * 730) return `+${Math.round(hours / (24 * 30))}mo`;
  return `+${Math.round(hours / (24 * 365))}y`;
}

export function Boards({ bookId, nav, theme, t }: { bookId: string; nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error } = useApi<BoardsData>(`/plotlint/boards/${encodeURIComponent(bookId)}`);

  if (loading) return <div className={c.muted}>{t("common.loading")}</div>;
  if (error) return <div className="text-red-400">{t("common.error")}: {error}</div>;
  if (!data) return null;

  const open = (chapter: number) => nav.toChapter(bookId, chapter);

  return (
    <div className="space-y-8">
      <div className={`flex items-center gap-2 text-sm ${c.muted}`}>
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span>/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span>/</span>
        <span className={c.subtle}>{t("boards.title")}</span>
      </div>

      <h1 className="text-2xl font-semibold">{t("boards.title")}</h1>
      {data.stateMissing && <p className={c.muted}>{t("boards.noState")}</p>}

      {data.hooks && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("boards.hooks")}</h2>
          <p className={`text-sm ${c.muted}`}>{t("boards.hooksHint")}</p>
          <OpenCurve counts={data.hooks.openPerChapter} onOpen={open} c={c} t={t} />
          <div className="grid gap-4 md:grid-cols-3">
            {COLUMNS.map((column) => {
              const cards = data.hooks!.cards.filter((card) => card.column === column);
              return (
                <div key={column} className={`border ${c.cardStatic} rounded-lg p-3 space-y-2`}>
                  <h3 className={`text-sm font-medium ${c.subtle}`}>{t(`boards.column.${column}` as const)} ({cards.length})</h3>
                  {cards.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => open(card.resolvedIn ?? (card.lastAdvanced || card.opened || 1))}
                      className={`block w-full text-left rounded-md border p-2 text-sm hover:bg-secondary/50 ${card.findings.some((f) => f.severity !== "note") ? "border-amber-500/60" : "border-border/50"}`}
                    >
                      <div className="flex justify-between gap-2">
                        <span className="font-mono text-xs">{card.id}</span>
                        <span className={`text-xs tabular-nums ${c.muted}`}>
                          {card.offPage ? t("boards.offPage") : `ch${card.opened || card.lastAdvanced}→ch${card.resolvedIn ?? card.lastAdvanced}`}
                          {card.age !== null && card.age > 0 ? ` · ${card.age} ${t("boards.chaptersWaiting")}` : ""}
                        </span>
                      </div>
                      <div className="mt-1">{card.promise}</div>
                      {card.findings.map((finding, i) => (
                        <div key={i} className="mt-1 text-xs text-amber-500">{finding.summary}</div>
                      ))}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {data.timeline && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("boards.timeline")}</h2>
          <p className={`text-sm ${c.muted}`}>{t("boards.timelineHint")}</p>
          <ol className="relative border-l border-border/60 ml-3 space-y-3">
            {data.timeline.chapters.map((chapter, index, all) => {
              const previous = all.slice(0, index).reverse().find((entry) => entry.at !== null);
              const gap = chapter.at !== null && previous?.at != null ? chapter.at - previous.at : null;
              return (
                <li key={chapter.chapter} className="ml-4">
                  <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ${chapter.conflicts.length ? "bg-red-500" : chapter.basis === "unknown" ? "bg-border" : "bg-primary"}`} />
                  <button onClick={() => open(chapter.chapter)} className="text-left w-full hover:bg-secondary/40 rounded-md p-1">
                    <div className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="font-medium">ch{chapter.chapter}</span>
                      {gap !== null && gap > 0 && <span className={`text-xs tabular-nums ${c.muted}`}>{formatGap(gap)}</span>}
                      {gap !== null && gap < 0 && <span className="text-xs text-red-500">{t("boards.backwards")}</span>}
                      {chapter.looksBack && <span className={`text-xs ${c.muted}`}>{t("boards.looksBack")}</span>}
                      {[...chapter.dates, ...chapter.markers].map((mark, i) => (
                        <span key={i} className={`text-xs ${c.subtle}`}>{mark.label}</span>
                      ))}
                    </div>
                    {chapter.conflicts.map((finding, i) => (
                      <div key={i} className="text-xs text-red-500 mt-1">{finding.summary}</div>
                    ))}
                  </button>
                </li>
              );
            })}
          </ol>
          {data.timeline.unplaced.map((finding, i) => (
            <div key={i} className="text-xs text-red-500">{finding.summary}</div>
          ))}
        </section>
      )}

      {data.cast && data.cast.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("boards.cast")}</h2>
          <p className={`text-sm ${c.muted}`}>{t("boards.castHint")}</p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {data.cast.map((member) => (
              <div key={member.name} id={castAnchor(member.name)} className={`border rounded-lg p-3 text-sm space-y-1 ${member.findings.some((f) => f.severity === "error") ? "border-red-500/60" : "border-border/50"}`}>
                <div className="flex justify-between gap-2">
                  <button onClick={() => open(member.firstSeen || 1)} className="font-medium text-left hover:underline">{member.name}</button>
                  <span className={`text-xs tabular-nums ${c.muted}`}>{member.firstSeen ? `ch${member.firstSeen}–ch${member.lastSeen}` : ""}</span>
                </div>
                <div className={`flex flex-wrap gap-2 text-xs ${c.subtle}`}>
                  {member.status && <span className={member.status.toLowerCase() === "dead" ? "text-red-500" : ""}>{member.status}</span>}
                  {member.location && <span>@ {member.location}</span>}
                  {member.povChapters.length > 0 && <span>{t("boards.pov")} ×{member.povChapters.length}</span>}
                </div>
                {member.relations.map((relation, i) => (
                  <div key={i} className="text-xs">
                    {relation.with
                      ? <a href={`#${castAnchor(relation.with)}`} onClick={(e) => { e.preventDefault(); document.getElementById(castAnchor(relation.with!))?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className={c.link}>{relation.object}</a>
                      : relation.object}
                    <span className={c.muted}> · ch{relation.since}</span>
                  </div>
                ))}
                {member.findings.map((finding, i) => (
                  <button key={i} onClick={() => finding.chapter && open(finding.chapter)} className="block text-left text-xs text-red-500">{finding.summary}</button>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.tension && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("boards.tension")}</h2>
          <p className={`text-sm ${c.muted}`}>{t("boards.tensionHint")}</p>
          {data.tension.points.length === 0
            ? <p className={`text-sm ${c.muted}`}>{t("boards.noTension")}</p>
            : <TensionCurve points={data.tension.points} onOpen={open} t={t} />}
          {data.tension.findings.map((finding, i) => (
            <button key={i} onClick={() => finding.chapter && open(finding.chapter)} className="block text-left text-xs text-amber-500">{finding.summary}</button>
          ))}
        </section>
      )}
    </div>
  );
}

/** The element id of a cast card, so a relationship can point to the card of the person it names. */
export const castAnchor = (name: string) => `cast-${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}`;

function TensionCurve({ points, onOpen, t }: { points: ReadonlyArray<TensionPoint>; onOpen: (chapter: number) => void; t: TFunction }) {
  return (
    <div className="flex items-end gap-0.5 h-24" role="img" aria-label={t("boards.tension")}>
      {points.map((point) => (
        <button
          key={point.chapter}
          title={`ch${point.chapter}: ${point.stakes}/10${point.pov ? ` · ${point.pov}` : ""}${point.goal ? `: ${point.goal}` : ""}`}
          onClick={() => onOpen(point.chapter)}
          className="flex-1 min-w-[3px] rounded-t bg-primary/60 hover:bg-primary"
          style={{ height: `${Math.max(4, point.stakes * 10)}%` }}
        />
      ))}
    </div>
  );
}

function OpenCurve({ counts, onOpen, c, t }: { counts: number[]; onOpen: (chapter: number) => void; c: ReturnType<typeof useColors>; t: TFunction }) {
  const values = counts.slice(1);
  const max = Math.max(1, ...values);
  if (!values.length) return null;
  return (
    <div>
      <div className={`text-xs ${c.muted} mb-1`}>{t("boards.openPerChapter")}</div>
      <div className="flex items-end gap-0.5 h-16" role="img" aria-label={t("boards.openPerChapter")}>
        {values.map((count, i) => (
          <button
            key={i}
            title={`ch${i + 1}: ${count}`}
            onClick={() => onOpen(i + 1)}
            className={`flex-1 min-w-[3px] rounded-t ${count === 0 ? "bg-red-500/50" : "bg-primary/60 hover:bg-primary"}`}
            style={{ height: `${Math.max(6, (count / max) * 100)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
