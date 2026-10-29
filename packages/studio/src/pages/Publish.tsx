import { useEffect, useState } from "react";
import { fetchJson, postApi, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

// Exports and what-if branches (PLAN phase 6). Download the manuscript, outline and
// provenance report; branch the book, and compare a branch with the main line in
// text and world state. Adopting a branch replaces the book, so it stays a command
// (`inkos lint branch adopt`), shown here for the branch in view.

interface Branch { readonly name: string; readonly id: string; readonly title: string; readonly createdAt: string }

interface BranchDiff {
  readonly branchId: string;
  readonly chapters: ReadonlyArray<{ chapter: number; status: "changed" | "added" | "removed"; wordsAdded: number; wordsRemoved: number }>;
  readonly facts: ReadonlyArray<{ subject: string; predicate: string; main: string | null; branch: string | null }>;
  readonly hooks: ReadonlyArray<{ id: string; promise: string; main: string | null; branch: string | null }>;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
  toChapter: (bookId: string, chapter: number) => void;
}

/** The manuscript download link for the form's fields. */
export function manuscriptHref(bookId: string, author: string, byline: string, contact: string): string {
  const query = new URLSearchParams({ author: author.trim() });
  if (byline.trim()) query.set("byline", byline.trim());
  for (const line of contact.split("\n").map((entry) => entry.trim()).filter(Boolean)) query.append("contact", line);
  return `/api/v1/plotlint/export/${encodeURIComponent(bookId)}/manuscript?${query}`;
}

const STORAGE_KEY = "plotlint.manuscript.author";

function loadAuthor(): { author: string; byline: string; contact: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return { author: String(saved.author ?? ""), byline: String(saved.byline ?? ""), contact: String(saved.contact ?? "") };
  } catch {
    return { author: "", byline: "", contact: "" };
  }
}

export function Publish({ bookId, nav, theme, t }: { bookId: string; nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [author, setAuthor] = useState(() => loadAuthor());
  const branches = useApi<{ branches: Branch[] }>(`/plotlint/branches/${encodeURIComponent(bookId)}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<BranchDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(author));
    } catch {
      // Private windows may refuse storage; the form still works.
    }
  }, [author]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    setDiff(null);
    setDiffError(null);
    fetchJson<BranchDiff>(`/plotlint/branches/${encodeURIComponent(bookId)}/${encodeURIComponent(selected)}/diff`)
      .then((data) => { if (live) setDiff(data); })
      .catch((error: unknown) => { if (live) setDiffError(String(error instanceof Error ? error.message : error)); });
    return () => { live = false; };
  }, [bookId, selected]);

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await postApi<{ id: string }>(`/plotlint/branches/${encodeURIComponent(bookId)}`, { name: name.trim() });
      setName("");
      await branches.refetch();
      setSelected(name.trim());
    } catch (error) {
      setCreateError(String(error instanceof Error ? error.message : error));
    } finally {
      setCreating(false);
    }
  };

  const input = `w-full rounded-md border border-border/60 bg-transparent px-3 py-2 text-sm`;
  const button = "inline-flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary/50 text-muted-foreground rounded-lg hover:text-foreground hover:bg-secondary transition-all border border-border/50 disabled:opacity-50";

  return (
    <div className="space-y-8">
      <div className={`flex items-center gap-2 text-sm ${c.muted}`}>
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span>/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span>/</span>
        <span className={c.subtle}>{t("publish.title")}</span>
      </div>
      <h1 className="text-2xl font-semibold">{t("publish.title")}</h1>

      <section className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
        <h2 className="text-lg font-semibold">{t("publish.export")}</h2>
        <p className={`text-sm ${c.muted}`}>{t("publish.exportHint")}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm space-y-1">
            <span className={c.subtle}>{t("publish.author")}</span>
            <input className={input} value={author.author} onChange={(e) => setAuthor({ ...author, author: e.target.value })} />
          </label>
          <label className="text-sm space-y-1">
            <span className={c.subtle}>{t("publish.byline")}</span>
            <input className={input} value={author.byline} onChange={(e) => setAuthor({ ...author, byline: e.target.value })} />
          </label>
          <label className="text-sm space-y-1 md:col-span-2">
            <span className={c.subtle}>{t("publish.contact")}</span>
            <textarea className={input} rows={3} value={author.contact} onChange={(e) => setAuthor({ ...author, contact: e.target.value })} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {author.author.trim()
            ? <a className={button} href={manuscriptHref(bookId, author.author, author.byline, author.contact)}>{t("publish.manuscript")}</a>
            : <span className={`${button} opacity-50`} title={t("publish.needAuthor")}>{t("publish.manuscript")}</span>}
          <a className={button} href={`/api/v1/plotlint/export/${encodeURIComponent(bookId)}/outline`}>{t("publish.outline")}</a>
          <a className={button} href={`/api/v1/plotlint/export/${encodeURIComponent(bookId)}/provenance`}>{t("publish.provenance")}</a>
        </div>
        <p className={`text-xs ${c.muted}`}>{t("publish.draftsHint")}</p>
      </section>

      <section className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
        <h2 className="text-lg font-semibold">{t("publish.branches")}</h2>
        <p className={`text-sm ${c.muted}`}>{t("publish.branchesHint")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm space-y-1">
            <span className={c.subtle}>{t("publish.branchName")}</span>
            <input className={input} value={name} placeholder="pell-drowns" onChange={(e) => setName(e.target.value.toLowerCase())} />
          </label>
          <button className={button} disabled={creating || !name.trim()} onClick={create}>{t("publish.createBranch")}</button>
        </div>
        {createError && <p className="text-sm text-red-500">{createError}</p>}
        {branches.data && branches.data.branches.length === 0 && <p className={`text-sm ${c.muted}`}>{t("publish.noBranches")}</p>}
        <div className="flex flex-wrap gap-2">
          {branches.data?.branches.map((branch) => (
            <button key={branch.id} onClick={() => setSelected(branch.name)} className={`${button} ${selected === branch.name ? "text-foreground bg-secondary" : ""}`}>
              {branch.name}
            </button>
          ))}
        </div>
        {diffError && <p className="text-sm text-red-500">{diffError}</p>}
        {diff && selected && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <button className={button} onClick={() => nav.toBook(diff.branchId)}>{t("publish.openBranch")}</button>
              <code className={`text-xs ${c.muted} self-center`}>inkos lint branch adopt {selected} {bookId} --yes</code>
            </div>
            <div>
              <h3 className={`font-medium ${c.subtle} mb-1`}>{t("publish.textDiff")}</h3>
              {diff.chapters.length === 0 ? <p className={c.muted}>{t("publish.same")}</p> : (
                <ul className="space-y-1">
                  {diff.chapters.map((change) => (
                    <li key={change.chapter} className="flex gap-3">
                      <button className={c.link} onClick={() => nav.toChapter(change.status === "removed" ? bookId : diff.branchId, change.chapter)}>ch{change.chapter}</button>
                      <span className="tabular-nums">
                        {change.status === "changed" ? <><span className="text-emerald-500">+{change.wordsAdded}</span> <span className="text-red-500">−{change.wordsRemoved}</span></>
                          : change.status === "added" ? t("publish.onlyBranch") : t("publish.onlyMain")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className={`font-medium ${c.subtle} mb-1`}>{t("publish.stateDiff")}</h3>
              {diff.facts.length === 0 ? <p className={c.muted}>{t("publish.same")}</p> : (
                <table className="w-full text-left">
                  <thead className={c.muted}><tr><th className="font-normal">{t("publish.fact")}</th><th className="font-normal">{t("publish.main")}</th><th className="font-normal">{selected}</th></tr></thead>
                  <tbody>
                    {diff.facts.map((change, i) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="py-1 pr-3">{change.subject} · {change.predicate}</td>
                        <td className="py-1 pr-3">{change.main ?? "—"}</td>
                        <td className="py-1">{change.branch ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {diff.hooks.length > 0 && (
              <div>
                <h3 className={`font-medium ${c.subtle} mb-1`}>{t("publish.hookDiff")}</h3>
                <ul className="space-y-1">
                  {diff.hooks.map((change) => (
                    <li key={change.id}><span className="font-mono text-xs">{change.id}</span>: {change.main ?? "—"} → {change.branch ?? "—"} <span className={c.muted}>({change.promise})</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
