import type { Diagnostic } from "@plotlint/diagnostics";
import { arbitrate, deferAllowed, judgeDefence, score, type ArbitrationLogEntry, type DefenceVerdict } from "./arbiter.js";
import { detectGaming } from "./gaming.js";
import { applyEdits, changedScenes, editRegion, overlaps, placeEdit, shiftOffset, touches, type EditProblem, type PlacedEdit } from "./spans.js";
import type { Author, AuthorResponse, Draft, EditScope, Editor, Finding, Score, Span } from "./types.js";
import { voiceDistance, voiceProfile } from "./voice.js";

// The closed loop over one chapter (PLAN, "Closed loop"): editors file findings, the
// arbiter dedupes and ranks them, the author agent fixes, defends or defers each,
// checks rerun on the changed scenes, and the loop stops when a stop condition holds.
// The Goodhart safeguards are built in: held-out checks the author never sees, gaming
// detectors, edits limited to the flagged region, a voice-distance limit, and a
// round and token budget. Everything is logged so a human can audit the run.

/** Checks the author agent never sees: measured every round, compared at the end. */
export const DEFAULT_HELD_OUT: ReadonlyArray<string> = ["metrics/predictability", "metrics/repeated-phrase", "loop/*"];

export interface HeldOut {
  /** Rule ids or globs whose findings are hidden from the author. Default `DEFAULT_HELD_OUT`. */
  readonly rules?: ReadonlyArray<string>;
  /** Judges that run only on the starting and final drafts (a reader persona or model the loop never used). */
  readonly final?: ReadonlyArray<Editor>;
}

export type StopReason = "clean" | "escalated" | "rounds" | "tokens" | "stalled" | "held-out" | "voice" | "author-failed";
export type GateMode = "none" | "escalations" | "end";

export interface LoopOptions {
  readonly chapter: number;
  readonly text: string;
  readonly editors: ReadonlyArray<Editor>;
  readonly author: Author;
  readonly heldOut?: HeldOut;
  /** The pack's priority list (rule ids or globs, highest first) for ranking and conflicts. */
  readonly priority?: ReadonlyArray<string>;
  /** How far around a flagged span the author may edit. Default `sentence`. */
  readonly scope?: EditScope;
  /** Author rounds. Default 4. */
  readonly maxRounds?: number;
  /** Open warnings allowed when the loop stops clean (the pack's threshold). Default 0. */
  readonly warningThreshold?: number;
  /** Rounds in a row without a lower visible score before the loop stops. Default 2. */
  readonly patience?: number;
  /** The author's chosen voice sample. Default: the starting draft. */
  readonly voiceSample?: string;
  /** How far the voice may drift from the sample (see `voiceLimit`). Default 0.04. */
  readonly voiceLimit?: number;
  /** Below this many words the voice measures are noise and the limit is not applied. Default 300. */
  readonly voiceMinWords?: number;
  /** Words the book already uses, for the thesaurus detector. Default: the starting draft's. */
  readonly vocabulary?: ReadonlySet<string>;
  /** Stop once `tokensUsed()` passes this. */
  readonly tokenBudget?: number;
  readonly tokensUsed?: () => number;
  /** Most of a round's findings the author may defend or defer before the rest escalate. Default 0.5. */
  readonly maxDefendShare?: number;
  /** When a human must look before the result is adopted. Default `escalations`. */
  readonly gate?: GateMode;
  /** Called after each round, so a caller can show progress. */
  readonly onRound?: (round: RoundLog) => void;
}

export interface Decision {
  readonly round: number;
  readonly findingKey: string;
  readonly ruleId: string;
  readonly severity: Diagnostic["severity"];
  readonly summary: string;
  readonly action: AuthorResponse["action"] | "none";
  readonly reason: string;
  /** For defend: the arbiter's verdict. For defer: accepted, or rejected for an error. For fix: applied or not. */
  readonly outcome: DefenceVerdict | "applied" | "not-applied" | "unanswered";
  readonly edits?: ReadonlyArray<{ readonly find: string; readonly replace: string; readonly problem?: EditProblem | "overlaps" }>;
}

export interface RoundLog {
  readonly round: number;
  /** Visible findings open at the start of the round (before the author answered). */
  readonly open: number;
  readonly visible: Score;
  readonly heldOut: Score;
  readonly voice: number;
  readonly arbitration: ReadonlyArray<ArbitrationLogEntry>;
  readonly decisions: ReadonlyArray<Decision>;
  readonly gaming: ReadonlyArray<Diagnostic>;
  /** Scenes the editors reran on after this round's edits. */
  readonly rerun?: ReadonlyArray<Span>;
  readonly tokens?: number;
}

export interface GateDecision {
  readonly mode: GateMode;
  readonly needsHuman: boolean;
  readonly reasons: ReadonlyArray<string>;
}

export interface LoopResult {
  readonly chapter: number;
  readonly original: string;
  readonly text: string;
  readonly rounds: ReadonlyArray<RoundLog>;
  readonly stop: { readonly reason: StopReason; readonly round: number; readonly detail?: string };
  /** Visible findings still open on the final draft, escalated ones included. */
  readonly open: ReadonlyArray<Diagnostic>;
  readonly deferred: ReadonlyArray<Decision>;
  readonly escalated: ReadonlyArray<Decision>;
  readonly defended: ReadonlyArray<Decision>;
  readonly heldOut: { readonly start: Score; readonly end: Score; readonly final?: { readonly start: Score; readonly end: Score } };
  readonly visible: { readonly start: Score; readonly end: Score };
  readonly voice: { readonly limit: number; readonly distance: number };
  readonly gate: GateDecision;
}

const globRegex = (glob: string) =>
  new RegExp(`^${glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join(".*")}$`, "u");

type Filed = Array<{ editor: string; diagnostic: Diagnostic }>;

/** Run every editor; incremental ones only on `scope`, keeping their earlier findings outside it. */
async function runEditors(
  editors: ReadonlyArray<Editor>,
  draft: Draft,
  round: number,
  previous: Map<string, Diagnostic[]> | undefined,
  scope: ReadonlyArray<Span> | undefined,
  placed: ReadonlyArray<PlacedEdit>,
): Promise<Map<string, Diagnostic[]>> {
  const result = new Map<string, Diagnostic[]>();
  for (const editor of editors) {
    if (editor.incremental && previous && scope) {
      const carried = (previous.get(editor.name) ?? []).flatMap((diagnostic) => {
        if (!diagnostic.range) return [diagnostic];
        const start = shiftOffset(diagnostic.range.start, placed);
        const end = Math.max(start, shiftOffset(diagnostic.range.end, placed));
        if (scope.some((span) => touches(span, { start, end }))) return [];
        return [{ ...diagnostic, range: { ...diagnostic.range, start, end } }];
      });
      const fresh = scope.length ? await editor.check({ draft, round, scope }) : [];
      result.set(editor.name, [...carried, ...fresh]);
    } else {
      result.set(editor.name, await editor.check({ draft, round }));
    }
  }
  return result;
}

const flatten = (byEditor: Map<string, Diagnostic[]>): Filed =>
  [...byEditor].flatMap(([editor, diagnostics]) => diagnostics.map((diagnostic) => ({ editor, diagnostic })));

/** Run the closed loop on one chapter. */
export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const { chapter, author } = options;
  const heldRules = (options.heldOut?.rules ?? DEFAULT_HELD_OUT).map(globRegex);
  const isHeld = (diagnostic: Diagnostic) => heldRules.some((regex) => regex.test(diagnostic.ruleId));
  const priority = options.priority ?? [];
  const scopeMode = options.scope ?? "sentence";
  const maxRounds = options.maxRounds ?? 4;
  const threshold = options.warningThreshold ?? 0;
  const patience = options.patience ?? 2;
  const voiceSample = voiceProfile(options.voiceSample ?? options.text);
  const voiceMinWords = options.voiceMinWords ?? 300;
  const voiceLimit = voiceSample.words < voiceMinWords || voiceProfile(options.text).words < voiceMinWords ? Infinity : options.voiceLimit ?? 0.04;
  const baseVoice = voiceDistance(voiceSample, options.text);
  const maxDefendShare = options.maxDefendShare ?? 0.5;
  const gateMode = options.gate ?? "escalations";
  const vocabulary = options.vocabulary ?? new Set(options.text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);

  let draft: Draft = { chapter, text: options.text };
  let filed = await runEditors(options.editors, draft, 0, undefined, undefined, []);
  let gaming: Diagnostic[] = [];
  const rounds: RoundLog[] = [];
  const settled = new Map<string, Decision>();
  const deferred: Decision[] = [];
  const escalated: Decision[] = [];
  const defended: Decision[] = [];
  /** The latest draft whose held-out score was no worse than the start, to fall back to. */
  let safe = { text: draft.text, filed, gaming };
  let best = Infinity;
  let sinceBest = 0;
  let start: { visible: Score; held: Score } | undefined;
  let stop: LoopResult["stop"] | undefined;

  const measure = () => {
    const all = flatten(filed).filter(({ diagnostic }) => diagnostic.chapter === undefined || diagnostic.chapter === chapter);
    const visibleFiled = all.filter(({ diagnostic }) => !isHeld(diagnostic));
    const arbitration = arbitrate(visibleFiled, draft.text, priority);
    // Open: what the author still has to answer. Escalated findings wait for the human, so the author
    // is not asked again, but they still count: an agent's defence never makes a finding go away.
    const open = arbitration.findings.filter((finding) => !settled.has(finding.key));
    const waiting = arbitration.findings.filter((finding) => settled.get(finding.key)?.outcome === "escalated");
    const held = [...all.filter(({ diagnostic }) => isHeld(diagnostic)).map(({ diagnostic }) => diagnostic), ...gaming];
    const visible = score([...open, ...waiting].map((finding) => finding.diagnostic));
    const blocking = (list: ReadonlyArray<Finding>) => list.filter((finding) => finding.diagnostic.severity !== "note").length;
    return { arbitration, open, waiting, blockingOpen: blocking(open), visible, held: score(held) };
  };

  for (let round = 1; ; round += 1) {
    const now = measure();
    start ??= { visible: now.visible, held: now.held };
    if (now.held.weighted <= start.held.weighted) safe = { text: draft.text, filed, gaming };

    // Stop conditions, checked on the draft as it stands.
    if (now.visible.errors === 0 && now.visible.warnings <= threshold) stop = { reason: "clean", round };
    else if (now.blockingOpen === 0 && now.waiting.some((finding) => finding.diagnostic.severity !== "note")) stop = { reason: "escalated", round, detail: `nothing left for the author: ${now.waiting.length} finding${now.waiting.length === 1 ? "" : "s"} wait for the human` };
    else if (round > maxRounds) stop = { reason: "rounds", round };
    else if (options.tokenBudget !== undefined && (options.tokensUsed?.() ?? 0) >= options.tokenBudget) stop = { reason: "tokens", round };
    else if (now.visible.weighted < start.visible.weighted && now.held.weighted > start.held.weighted) {
      stop = { reason: "held-out", round, detail: `visible score ${start.visible.weighted} → ${now.visible.weighted}, held-out ${start.held.weighted} → ${now.held.weighted}; kept the last draft whose held-out score had not risen` };
      draft = { chapter, text: safe.text };
      filed = safe.filed;
      gaming = safe.gaming;
    } else if (sinceBest >= patience) stop = { reason: "stalled", round, detail: `no lower visible score in ${patience} rounds` };
    if (now.visible.weighted < best) {
      best = now.visible.weighted;
      sinceBest = 0;
    }
    if (stop) break;

    // The author answers the open findings, each with the region it may edit.
    const findings = now.open.map((finding) => {
      const region = editRegion(draft.text, finding.span, scopeMode, chapter);
      return { ...finding, ...(region ? { region } : {}) };
    });
    let responses: AuthorResponse[];
    try {
      responses = await author.respond({ draft, round, findings, voiceSample: options.voiceSample ?? options.text });
    } catch (error) {
      stop = { reason: "author-failed", round, detail: String(error) };
      break;
    }

    const byId = new Map(responses.map((response) => [response.id, response]));
    const decisions: Decision[] = [];
    const placed: Array<PlacedEdit & { findingId: string }> = [];
    let excused = 0;
    for (const finding of findings) {
      const response = byId.get(finding.id);
      const base = { round, findingKey: finding.key, ruleId: finding.diagnostic.ruleId, severity: finding.diagnostic.severity, summary: finding.diagnostic.summary };
      if (!response) {
        decisions.push({ ...base, action: "none", reason: "", outcome: "unanswered" });
        continue;
      }
      if (response.action === "fix") {
        const edits: Array<NonNullable<Decision["edits"]>[number]> = [];
        let applied = 0;
        for (const edit of response.edits) {
          const at = placeEdit(draft.text, edit, finding.region);
          if (typeof at === "string") {
            edits.push({ ...edit, problem: at });
          } else if (placed.some((other) => overlaps(other.span, at.span) || (other.span.start === at.span.start))) {
            edits.push({ ...edit, problem: "overlaps" });
          } else {
            placed.push({ ...at, findingId: finding.id });
            edits.push({ ...edit });
            applied += 1;
          }
        }
        decisions.push({ ...base, action: "fix", reason: response.reason, outcome: applied ? "applied" : "not-applied", edits });
        continue;
      }
      // Defending or deferring more than the allowed share of the round's errors and warnings escalates the rest.
      // Notes are suggestions: a reasoned no is always an answer to one.
      const blocking = finding.diagnostic.severity !== "note";
      const overShare = blocking && excused + 1 > Math.max(1, Math.floor(maxDefendShare * findings.filter((f) => f.diagnostic.severity !== "note").length));
      let outcome: DefenceVerdict;
      if (response.action === "defend") outcome = overShare ? "escalated" : judgeDefence(finding, response);
      else outcome = !deferAllowed(finding) ? "rejected" : overShare ? "escalated" : "accepted";
      if (outcome === "accepted" && blocking) excused += 1;
      const decision: Decision = { ...base, action: response.action, reason: response.reason, outcome };
      decisions.push(decision);
      if (outcome === "accepted" || outcome === "escalated") settled.set(finding.key, decision);
      if (outcome === "escalated") escalated.push(decision);
      else if (outcome === "accepted") (response.action === "defend" ? defended : deferred).push(decision);
    }

    const before = draft.text;
    const { text: after, changed } = applyEdits(before, placed);
    const ordered = [...placed].sort((a, b) => a.span.start - b.span.start);
    const roundGaming = detectGaming({ chapter, before, after, edits: ordered, changed, findings, vocabulary });
    const voice = voiceDistance(voiceSample, after) - baseVoice;
    const tokens = options.tokensUsed?.();
    if (voice > voiceLimit) {
      rounds.push({ round, open: now.open.length, visible: now.visible, heldOut: now.held, voice, arbitration: now.arbitration.log, decisions, gaming: roundGaming, ...(tokens === undefined ? {} : { tokens }) });
      options.onRound?.(rounds[rounds.length - 1]!);
      stop = { reason: "voice", round, detail: `voice distance ${voice.toFixed(3)} over the limit ${voiceLimit.toFixed(3)}; this round's edits were not kept` };
      break;
    }

    // Earlier gaming flags move with the text; one the author has since rewritten is gone.
    gaming = [
      ...gaming.flatMap((diagnostic) => {
        const range = diagnostic.range!;
        if (placed.some((edit) => overlaps(edit.span, range))) return [];
        const s = shiftOffset(range.start, placed);
        return [{ ...diagnostic, range: { ...range, start: s, end: Math.max(s, shiftOffset(range.end, placed)) } }];
      }),
      ...roundGaming,
    ];
    draft = { chapter, text: after };
    const rerun = placed.length ? changedScenes(after, changed, chapter) : [];
    if (placed.length) filed = await runEditors(options.editors, draft, round, filed, rerun, placed);
    rounds.push({ round, open: now.open.length, visible: now.visible, heldOut: now.held, voice, arbitration: now.arbitration.log, decisions, gaming: roundGaming, rerun, ...(tokens === undefined ? {} : { tokens }) });
    options.onRound?.(rounds[rounds.length - 1]!);
    if (placed.length === 0) sinceBest += 1;
    else if (measure().visible.weighted >= best) sinceBest += 1;
  }

  const end = measure();
  let final: LoopResult["heldOut"]["final"];
  if (options.heldOut?.final?.length) {
    const judge = async (text: string) => score((await Promise.all(options.heldOut!.final!.map((editor) =>
      editor.check({ draft: { chapter, text }, round: maxRounds + 1 })))).flat());
    final = { start: await judge(options.text), end: await judge(draft.text) };
  }

  const reasons: string[] = [];
  if (escalated.length) reasons.push(`${escalated.length} finding${escalated.length === 1 ? "" : "s"} escalated by the arbiter`);
  if (stop!.reason === "held-out") reasons.push("held-out checks fell while visible scores rose");
  if (final && final.end.weighted > final.start.weighted) reasons.push("the final held-out judges scored the revision worse than the start");
  if (end.visible.errors > 0) reasons.push(`${end.visible.errors} error${end.visible.errors === 1 ? "" : "s"} still open`);
  const needsHuman = gateMode === "end" ? true : gateMode === "none" ? false : reasons.length > 0;

  return {
    chapter,
    original: options.text,
    text: draft.text,
    rounds,
    stop: stop!,
    open: [...end.open, ...end.waiting].map((finding) => finding.diagnostic),
    deferred,
    escalated,
    defended,
    heldOut: { start: start!.held, end: end.held, ...(final ? { final } : {}) },
    visible: { start: start!.visible, end: end.visible },
    voice: { limit: voiceLimit, distance: voiceDistance(voiceSample, draft.text) - baseVoice },
    gate: { mode: gateMode, needsHuman, reasons: gateMode === "end" && reasons.length === 0 ? ["every result goes to the human (gate: end)"] : reasons },
  };
}

/**
 * The single-pass baseline for the phase 5 gate: the same editors and author, one
 * round of answers, no reruns between rounds and no stop conditions beyond that.
 * The editors run once more on the result only to measure it.
 */
export function runSinglePass(options: LoopOptions): Promise<LoopResult> {
  return runLoop({ ...options, maxRounds: 1, voiceLimit: Infinity, patience: Infinity });
}

/** Editors over one lint function: continuity (L0–L3 state), developmental (L4) and line (L0–L2 text). */
export function layerEditors(check: (draft: Draft) => Promise<Diagnostic[]>): Editor[] {
  let cached: { text: string; result: Promise<Diagnostic[]> } | undefined;
  const run = (draft: Draft) => {
    if (cached?.text !== draft.text) cached = { text: draft.text, result: check(draft) };
    return cached.result;
  };
  const editor = (role: Editor["role"], layers: ReadonlyArray<Diagnostic["layer"]>): Editor => ({
    role,
    name: role,
    async check({ draft }) {
      return (await run(draft)).filter((diagnostic) => layers.includes(diagnostic.layer));
    },
  });
  return [
    editor("continuity", ["continuity"]),
    editor("developmental", ["structure"]),
    editor("line", ["mechanics", "style", "metrics"]),
  ];
}
