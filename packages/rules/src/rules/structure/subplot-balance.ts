import type { HookRecord, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { Rule } from "../../types.js";
import { normalize } from "../facts.js";
import { bookEnd, hookChapters, hookStart, isFinished, numberOption, renderHook, structureFinding, UNRESOLVED } from "./common.js";
import { personPhrases } from "../genre/people.js";
import { characterNames, mentionsAny } from "./terms.js";

// Subplot balance. InkOS hooks carry no thread field (`type` is a category such
// as "mystery" or "romance", shared by unrelated threads), so hooks are grouped
// into subplots by their `dependsOn` links, then by the character they mostly
// concern: the most specific character named in the hook's id, payoff and notes,
// leaving out characters named by more than half the hooks (the protagonist runs
// through every thread). A subplot of at least `minHooks` (default 2) hooks with
// one still unresolved that has gone quiet for `gap` (default 5) chapters before
// the last chapter is flagged: none of its hooks advances, and its character has
// no new fact. A character's thread with fewer hooks counts too when the
// character has facts in at least `minChapters` (default 3) chapters, since a
// settler often opens one hook for a thread and then only records facts for it.
// It is a warning in a finished book and a note in an unfinished one. Characters
// are named by their full name or their given name ("Bea" names "Bea Ashby"),
// never by a surname alone, which a family shares.

export interface Subplot {
  /** The character it concerns, or the first hook's id for a group linked by `dependsOn`. */
  readonly key: string;
  readonly hooks: ReadonlyArray<HookRecord>;
  /** Set when the subplot is a character's: the group is keyed by them. */
  readonly character?: boolean;
}

/** Whether the text names the character by full name (any case) or by given name (as written). */
function namesCharacter(text: string, name: string): boolean {
  const [full, ...parts] = personPhrases(name);
  if (full && mentionsAny(text, [full])) return true;
  const given = parts[0];
  return !!given && given !== full && name.trim().startsWith(given)
    && new RegExp(`(?<![\\p{L}\\p{N}])${given.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(text);
}

const hookText = (hook: HookRecord) => `${hook.hookId.replace(/[_-]+/gu, " ")}\n${hook.expectedPayoff}\n${hook.notes}`;

/** Group the hooks on the page into subplots. */
export function subplots(snapshot: RuntimeStateSnapshot): Subplot[] {
  const hooks = snapshot.hooks.hooks.filter((hook) => hookStart(hook) !== null && hook.status !== "superseded");
  const byId = new Map(hooks.map((hook) => [hook.hookId, hook]));
  // Union-find over dependsOn.
  const parent = new Map(hooks.map((hook) => [hook.hookId, hook.hookId]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  for (const hook of hooks) for (const dep of hook.dependsOn ?? []) if (byId.has(dep)) parent.set(root(hook.hookId), root(dep));

  const names = [...characterNames(snapshot)];
  const display = new Map<string, string>();
  for (const fact of snapshot.currentState.facts) if (names.includes(normalize(fact.subject))) display.set(normalize(fact.subject), fact.subject);
  const named = (hook: HookRecord) => names.filter((name) => display.has(name) && namesCharacter(hookText(hook), display.get(name)!));
  const frequency = new Map(names.map((name) => [name, hooks.filter((hook) => named(hook).includes(name)).length]));
  const common = (name: string) => hooks.length >= 4 && frequency.get(name)! > hooks.length / 2;

  const groups = new Map<string, HookRecord[]>();
  const components = new Map<string, HookRecord[]>();
  for (const hook of hooks) components.set(root(hook.hookId), [...(components.get(root(hook.hookId)) ?? []), hook]);
  for (const [id, members] of components) {
    if (members.length > 1) {
      groups.set(`hooks:${id}`, members);
      continue;
    }
    const hook = members[0]!;
    const candidates = named(hook).filter((name) => !common(name)).sort((a, b) => frequency.get(a)! - frequency.get(b)!);
    // The most specific character that more than one hook names, so a group can form.
    const key = candidates.find((name) => frequency.get(name)! >= 2) ?? candidates[0];
    if (key === undefined) continue;
    groups.set(key, [...(groups.get(key) ?? []), hook]);
  }
  return [...groups].map(([key, members]) => (key.startsWith("hooks:")
    ? { key: key.slice(6), hooks: members }
    : { key: display.get(key) ?? key, hooks: members, character: true }));
}

export const subplotBalance: Rule = {
  id: "structure/subplot-balance",
  layer: "structure",
  title: "Subplots that vanish",
  rationale: "A subplot the reader is following that drops out for many chapters without being resolved reads as forgotten. Bring it back, resolve it, or cut it.",
  source: "Robert McKee, Story (1997), ch. 11 on subplots; Donald Maass, Writing the Breakout Novel (2001), ch. 8 \"Subplots\"",
  check({ snapshot, chapters, book, options }) {
    const end = bookEnd(snapshot, chapters);
    const gap = Math.max(1, numberOption(options, "gap", 5));
    const minHooks = Math.max(1, numberOption(options, "minHooks", 2));
    const minChapters = Math.max(1, numberOption(options, "minChapters", 3));
    const finished = isFinished({ options, book }, end);
    const findings: Diagnostic[] = [];
    for (const subplot of subplots(snapshot)) {
      const open = subplot.hooks.filter((hook) => UNRESOLVED.has(hook.status));
      if (open.length === 0) continue;
      const key = normalize(subplot.key);
      const factChapters = new Set(subplot.character
        ? snapshot.currentState.facts.filter((fact) => normalize(fact.subject) === key).map((fact) => fact.sourceChapter)
        : []);
      if (subplot.hooks.length < minHooks && factChapters.size < minChapters) continue;
      const active = new Set([...subplot.hooks.flatMap((hook) => hookChapters(snapshot, hook)), ...factChapters]);
      const last = Math.max(...active);
      if (end - last < gap) continue;
      findings.push(structureFinding(this, {
        chapter: last, severity: finished ? "warning" : "note",
        summary: `The ${subplot.key} subplot vanishes after ch${last} (${end - last} chapters before the end) with ${open.length} question${open.length === 1 ? "" : "s"} unresolved.`,
        evidence: subplot.hooks.map(renderHook),
      }));
    }
    return findings;
  },
};
