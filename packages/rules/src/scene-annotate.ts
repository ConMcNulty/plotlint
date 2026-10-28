import { locateQuote } from "@actalk/inkos-core";
import { extractJson, type CompileMessage, type CompleteFn } from "./invariant-compile.js";
import {
  mergeSceneAnnotations, sceneBody, sceneHash, SceneAnnotationSchema, SceneOutcomeSchema,
  type PovBreak, type SceneAnnotation, type SceneOutcome, type SceneValue, type TurningPoint,
} from "./scene-annotations.js";
import { segmentScenes, type Scene } from "./scenes.js";

// Annotating a chapter's scenes with an LLM for the structural checks: POV,
// goal, opposition, outcome, value at start and end, the turning point, stakes
// and passages that break the viewpoint. The model only proposes data: the
// reply is parsed, repaired, validated, and every quote it gives is looked up in
// the scene's text; a quote that is not there is dropped, and a turning point or
// POV break without a passage to show for it is dropped with it. The LLM call is
// injected, so this module needs no client and the tests use a fake.

export type AnnotateLanguage = "en" | "zh";

export interface AnnotateOptions {
  /** `llm@<model>`, stored on each entry. */
  readonly annotator: string;
  /** The chapter's current entries; unchanged scenes and the author's entries are kept as they are. */
  readonly existing?: ReadonlyArray<SceneAnnotation>;
  /** Re-annotate scenes whose text has not changed. The author's entries are still kept. */
  readonly force?: boolean;
  /** Prompt language; detected from the text when absent. */
  readonly language?: AnnotateLanguage;
  readonly protagonist?: string;
  /** Character names in the book's state, so the model uses the book's spellings. */
  readonly names?: ReadonlyArray<string>;
  /** Model calls per chapter, counting the retry after a bad reply. Default 2. */
  readonly attempts?: number;
  /** Called before each model call with the scenes it annotates, so a caller can show progress. */
  readonly onCall?: (sceneIds: ReadonlyArray<string>, attempt: number) => void;
}

export interface QuoteStats {
  readonly given: number;
  readonly located: number;
}

export interface ChapterAnnotation {
  readonly chapter: number;
  /** Every entry for the chapter after this run, in scene order. */
  readonly scenes: SceneAnnotation[];
  /** Scene ids annotated in this run. */
  readonly annotated: string[];
  /** Scene ids kept as they were: the author's entries and unchanged scenes. */
  readonly kept: string[];
  /** Scene ids the model was asked about but did not annotate. */
  readonly missing: string[];
  readonly quotes: QuoteStats;
  /** Model calls made (0 when nothing needed annotating). */
  readonly calls: number;
}

const SYSTEM_EN = `You annotate the scenes of one chapter of a novel for a developmental editor. The chapter comes with each scene opened by a line "=== SCENE <id> ===". Describe what the text shows, not what it should show.

Reply with one JSON object and nothing else:
{ "scenes": [ {
  "id": "<scene id>",
  "pov": "<the viewpoint character's name, or null when the narration has no single viewpoint>",
  "goal": "<what the POV character wants or tries to do in this scene, a few words, or null if nothing>",
  "opposition": "<who or what stands in the way, a few words, or null if nothing does>",
  "outcome": "success" | "failure" | "mixed" | "none",
  "valueStart": { "axis": "<one word: safety, trust, love, status, knowledge, freedom, hope, wealth, health, ...>", "value": <-2 to 2> },
  "valueEnd": { "axis": "<the same axis>", "value": <-2 to 2> },
  "turningPoint": { "description": "<what turns>", "causedBy": "protagonist" | "other" | "circumstance", "by": "<who caused it>", "evidence": "<quote>" } or null,
  "stakes": <0 to 10>,
  "povBreaks": [ { "quote": "<quote>", "note": "<what the POV character could not know or perceive>" } ],
  "evidence": { "goal": "<quote>", "opposition": "<quote>", "outcome": "<quote>" }
} ] }

Rules:
- Quotes are copied exactly from that scene's text: one sentence or clause of 5 to 25 words, character for character, never paraphrased, shortened or joined from two places. Leave a quote out rather than invent one.
- valueStart and valueEnd use the same axis: the value most at stake for the POV character. -2 is worst, 0 neutral, 2 best. When nothing changes, give the same value at both ends.
- outcome: did the POV character get what they wanted? "none" when they wanted nothing or the scene ends before it is decided.
- turningPoint: the moment the scene changes direction, or null when it does not. causedBy is "protagonist" when the protagonist's own choice or action causes it, "other" for another character's, "circumstance" for chance, nature or events.
- stakes: how much the POV character stands to lose in this scene, judged on this scale and not on how dramatic the book is overall: 0-1 nothing (travel, rest, chores), 2-3 comfort or pride (an awkward talk, a small errand), 4-5 something they care about (a job, a secret, a friendship), 6-7 something they cannot replace (a home, a loved one's trust, their freedom), 8-9 their life or a loved one's life in immediate danger, 10 everything at once. Most scenes in most books are 2 to 6.
- povBreaks: only clear cases where the narration reports another character's unspoken thoughts or feelings, or events the POV character cannot see. Usually [].
- Annotate every scene id you are asked about, in order.`;

const SYSTEM_ZH = `你为发展编辑标注小说一章中的各个场景。每个场景以一行 "=== SCENE <id> ===" 开头。只描述文本实际写了什么。

只回复一个 JSON 对象，不要其他文字，键名保持英文：
{ "scenes": [ { "id": "<场景 id>", "pov": "<视角人物姓名，或 null>", "goal": "<视角人物在本场景想要什么，或 null>", "opposition": "<阻碍他的人或事，或 null>", "outcome": "success" | "failure" | "mixed" | "none", "valueStart": { "axis": "<一个词：安全、信任、爱情、地位、真相、自由、希望、财富……>", "value": <-2 到 2> }, "valueEnd": { "axis": "<同一个词>", "value": <-2 到 2> }, "turningPoint": { "description": "<转折是什么>", "causedBy": "protagonist" | "other" | "circumstance", "by": "<谁造成的>", "evidence": "<引文>" } 或 null, "stakes": <0 到 10>, "povBreaks": [ { "quote": "<引文>", "note": "<视角人物无法知道或感知的内容>" } ], "evidence": { "goal": "<引文>", "opposition": "<引文>", "outcome": "<引文>" } } ] }

规则：
- 引文必须逐字照抄该场景原文中的一句话（10 到 40 个字），不改写、不缩写、不拼接。宁可省略也不要编造。
- valueStart 与 valueEnd 用同一个 axis；-2 最坏，0 中性，2 最好；没有变化就给相同的值。
- causedBy：主角自己的选择或行动为 "protagonist"，其他角色为 "other"，偶然、自然或局势为 "circumstance"。
- stakes：视角人物在本场景可能失去多少，按此刻度判断：0-1 毫无（赶路、休息），2-3 面子或舒适，4-5 在乎的东西（差事、秘密、友谊），6-7 无法替代的东西（家园、亲人的信任、自由），8-9 自己或亲人的性命当场受威胁，10 一切。多数场景在 2 到 6 之间。
- povBreaks 只列明显的视角越界（写出他人未说出口的想法，或视角人物看不到的事），通常为 []。
- 按顺序标注要求的每一个场景 id。`;

const CJK = /[㐀-鿿豈-﫿]/gu;
const LETTER = /[\p{L}]/gu;

/** "zh" when most letters in the text are CJK. */
export function detectLanguage(text: string): AnnotateLanguage {
  const letters = text.match(LETTER)?.length ?? 0;
  const cjk = text.match(CJK)?.length ?? 0;
  return letters > 0 && cjk / letters > 0.5 ? "zh" : "en";
}

/** The chapter text with each scene opened by its `=== SCENE <id> ===` line. */
export function markScenes(text: string, scenes: ReadonlyArray<Scene>): string {
  // The first scene starts at the top of the file, so it holds the chapter's title line.
  const body = (scene: Scene) => sceneBody(text, scene).trim().replace(scene.index === 0 ? /^#[^\n]*\n+/u : /^$/u, "");
  return scenes.map((scene) => `=== SCENE ${scene.id} ===\n${body(scene)}`).join("\n\n");
}

/** The messages that ask a model to annotate some of a chapter's scenes. */
export function annotationPrompt(
  chapter: number,
  text: string,
  scenes: ReadonlyArray<Scene>,
  ids: ReadonlyArray<string>,
  options: Pick<AnnotateOptions, "language" | "protagonist" | "names"> = {},
): CompileMessage[] {
  const zh = (options.language ?? detectLanguage(text)) === "zh";
  const lines = [
    zh ? `第 ${chapter} 章。要标注的场景：${ids.join(", ")}` : `Chapter ${chapter}. Scenes to annotate: ${ids.join(", ")}`,
  ];
  if (options.protagonist) lines.push(zh ? `主角：${options.protagonist}` : `The protagonist: ${options.protagonist}`);
  if (options.names?.length) lines.push(`${zh ? "书中人物" : "Names in this book"}: ${options.names.slice(0, 60).join(", ")}`);
  lines.push("", markScenes(text, scenes));
  return [{ role: "system", content: zh ? SYSTEM_ZH : SYSTEM_EN }, { role: "user", content: lines.join("\n") }];
}

/** One scene as the model proposed it, repaired but with its quotes not yet checked against the text. */
export interface ProposedScene {
  readonly id: string;
  readonly pov: string | null;
  readonly goal: string | null;
  readonly opposition: string | null;
  readonly outcome: SceneOutcome | null;
  readonly valueStart: SceneValue | null;
  readonly valueEnd: SceneValue | null;
  readonly turningPoint: TurningPoint | null;
  readonly stakes: number | null;
  readonly povBreaks: PovBreak[];
  readonly evidence: { goal?: string; opposition?: string; outcome?: string };
}

export type AnnotationParseResult =
  | { readonly ok: true; readonly scenes: ProposedScene[] }
  | { readonly ok: false; readonly error: string };

const EMPTY = /^(?:null|none|n\/?a|nothing|no one|nobody|unknown|unclear|-|—|无|没有|不明|未知)?$/iu;

function text(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return EMPTY.test(trimmed) ? null : trimmed;
}

const OUTCOMES: Record<string, SceneOutcome> = {
  success: "success", succeeds: "success", win: "success", won: "success", yes: "success", 成功: "success",
  failure: "failure", fail: "failure", fails: "failure", failed: "failure", loss: "failure", no: "failure", 失败: "failure",
  mixed: "mixed", partial: "mixed", "partial success": "mixed", ambiguous: "mixed", 部分成功: "mixed", 喜忧参半: "mixed",
  none: "none", undecided: "none", unresolved: "none", 无: "none", 未定: "none",
};

function outcome(value: unknown): SceneOutcome | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (SceneOutcomeSchema.safeParse(key).success) return key as SceneOutcome;
  return OUTCOMES[key] ?? null;
}

function number(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\s*[+-]?\d+(?:\.\d+)?\s*$/u.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function sceneValue(value: unknown, fallbackAxis?: string): SceneValue | null {
  if (typeof value === "number" || typeof value === "string") {
    const bare = number(value, -2, 2);
    return bare === null ? null : { axis: fallbackAxis ?? "value", value: bare };
  }
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const score = number(record.value, -2, 2);
  const axis = text(record.axis) ?? fallbackAxis;
  return score === null || !axis ? null : { axis: axis.toLowerCase(), value: score };
}

function causedBy(value: unknown): TurningPoint["causedBy"] | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (/^(?:protagonist|pov|hero|heroine|self|主角|视角人物)/u.test(key)) return "protagonist";
  if (/^(?:circumstance|chance|accident|event|nature|fate|luck|coincidence|environment|偶然|局势|环境|意外|命运)/u.test(key)) return "circumstance";
  if (/^(?:other|antagonist|character|another|someone|ally|enemy|他人|其他|反派|配角)/u.test(key)) return "other";
  return null;
}

function turningPoint(value: unknown): TurningPoint | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const description = text(record.description);
  const cause = causedBy(record.causedBy ?? record.caused_by ?? record.cause);
  const evidence = text(record.evidence ?? record.quote);
  if (!description || !cause || !evidence) return null;
  const by = text(record.by);
  return { description, causedBy: cause, ...(by ? { by } : {}), evidence };
}

function povBreaks(value: unknown): PovBreak[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item === null || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const quote = text(record.quote ?? record.evidence);
    const note = text(record.note ?? record.reason) ?? "reports what the POV character cannot know";
    return quote ? [{ quote, note }] : [];
  });
}

function evidence(value: unknown): ProposedScene["evidence"] {
  if (value === null || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const out: { goal?: string; opposition?: string; outcome?: string } = {};
  for (const key of ["goal", "opposition", "outcome"] as const) {
    const quote = text(record[key]);
    if (quote) out[key] = quote;
  }
  return out;
}

const normalizeId = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase().replace(/\s+|_/gu, ".").replace(/\.{2,}/gu, ".") : "";

/**
 * Parse a model's reply: `{ scenes: [...] }` or a bare array of scenes. Small
 * slips are repaired ("null" for null, "Failure" for "failure", 3 for a value of
 * 2, numbers as strings); fields that cannot be read become null. Entries
 * without an id take the requested ids in order when the counts match.
 */
export function parseAnnotationReply(reply: string, ids: ReadonlyArray<string>): AnnotationParseResult {
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/giu, "");
  const arrayFirst = cleaned.indexOf("[") >= 0 && (cleaned.indexOf("{") < 0 || cleaned.indexOf("[") < cleaned.indexOf("{"));
  let parsed: unknown;
  try {
    if (arrayFirst) {
      const wrapped = extractJson(`{"scenes":${cleaned.slice(cleaned.indexOf("["))}}`);
      parsed = wrapped === null ? null : JSON.parse(wrapped);
    } else {
      const json = extractJson(cleaned);
      parsed = json === null ? null : JSON.parse(json);
    }
  } catch (error) {
    return { ok: false, error: `the JSON does not parse: ${(error as Error).message}` };
  }
  if (parsed === null) return { ok: false, error: "the reply has no JSON object" };
  const record = parsed as Record<string, unknown>;
  const list = Array.isArray(record.scenes) ? record.scenes
    : typeof record.id === "string" ? [record]
    : null;
  if (!list) return { ok: false, error: "the reply has no \"scenes\" array" };

  const wanted = new Set(ids);
  const positional = list.length === ids.length && list.every((item) => !(item && typeof item === "object" && wanted.has(normalizeId((item as Record<string, unknown>).id))));
  const scenes: ProposedScene[] = [];
  list.forEach((item, index) => {
    if (item === null || typeof item !== "object") return;
    const entry = item as Record<string, unknown>;
    const id = positional ? ids[index]! : normalizeId(entry.id);
    if (!wanted.has(id) || scenes.some((scene) => scene.id === id)) return;
    const start = sceneValue(entry.valueStart ?? entry.value_start);
    const end = sceneValue(entry.valueEnd ?? entry.value_end, start?.axis);
    scenes.push({
      id,
      pov: text(entry.pov),
      goal: text(entry.goal),
      opposition: text(entry.opposition),
      outcome: outcome(entry.outcome),
      valueStart: start,
      valueEnd: end,
      turningPoint: turningPoint(entry.turningPoint ?? entry.turning_point),
      stakes: number(entry.stakes, 0, 10),
      povBreaks: povBreaks(entry.povBreaks ?? entry.pov_breaks),
      evidence: evidence(entry.evidence),
    });
  });
  if (scenes.length === 0) return { ok: false, error: `no entry names one of the scene ids ${ids.join(", ")}` };
  return { ok: true, scenes };
}

/**
 * Check a proposed scene's quotes against the scene's text: each is replaced by
 * the passage as the author wrote it, or dropped when it is not there.
 */
export function groundScene(
  proposed: ProposedScene,
  body: string,
  meta: { chapter: number; scene: number; annotator: string; sceneHash: string },
): { annotation: SceneAnnotation; quotes: QuoteStats } {
  let given = 0;
  let located = 0;
  const ground = (quote: string | undefined): string | undefined => {
    if (!quote) return undefined;
    given += 1;
    const span = locateQuote(body, quote);
    if (!span) return undefined;
    located += 1;
    return body.slice(span.start, span.end);
  };
  const quotes: { goal?: string; opposition?: string; outcome?: string } = {};
  for (const key of ["goal", "opposition", "outcome"] as const) {
    const found = ground(proposed.evidence[key]);
    if (found) quotes[key] = found;
  }
  const turnEvidence = ground(proposed.turningPoint?.evidence);
  const breaks = proposed.povBreaks.flatMap((entry) => {
    const quote = ground(entry.quote);
    return quote ? [{ quote, note: entry.note }] : [];
  });
  const annotation = SceneAnnotationSchema.parse({
    id: proposed.id,
    chapter: meta.chapter,
    scene: meta.scene,
    pov: proposed.pov,
    goal: proposed.goal,
    opposition: proposed.opposition,
    outcome: proposed.outcome,
    // A value with no partner cannot show a turn either way.
    valueStart: proposed.valueStart && proposed.valueEnd ? proposed.valueStart : null,
    valueEnd: proposed.valueStart && proposed.valueEnd ? proposed.valueEnd : null,
    turningPoint: proposed.turningPoint && turnEvidence ? { ...proposed.turningPoint, evidence: turnEvidence } : null,
    stakes: proposed.stakes,
    ...(breaks.length ? { povBreaks: breaks } : {}),
    evidence: quotes,
    annotator: meta.annotator,
    sceneHash: meta.sceneHash,
  });
  return { annotation, quotes: { given, located } };
}

/**
 * Annotate one chapter's scenes. Scenes whose text is unchanged since their
 * last annotation, and every entry the author wrote, are kept; the rest go to
 * the model in one call, with the whole chapter for context. A reply that does
 * not parse is sent back once with the problem.
 */
export async function annotateChapter(
  chapter: number,
  chapterText: string,
  complete: CompleteFn,
  options: AnnotateOptions,
): Promise<ChapterAnnotation> {
  const scenes = segmentScenes(chapterText, { chapter });
  const existing = new Map((options.existing ?? []).filter((entry) => entry.chapter === chapter).map((entry) => [entry.id, entry]));
  const hashes = new Map(scenes.map((scene) => [scene.id, sceneHash(sceneBody(chapterText, scene))]));
  const todo = scenes.filter((scene) => {
    const entry = existing.get(scene.id);
    if (entry?.annotator === "author") return false;
    return options.force || !entry || entry.sceneHash !== hashes.get(scene.id);
  });
  const kept = scenes.filter((scene) => !todo.includes(scene) && existing.has(scene.id)).map((scene) => scene.id);
  const finish = (fresh: SceneAnnotation[], quotes: QuoteStats, calls: number, missing: string[]): ChapterAnnotation => ({
    chapter,
    scenes: mergeSceneAnnotations(
      [...existing.values()].filter((entry) => hashes.has(entry.id) || entry.annotator === "author"),
      fresh,
    ),
    annotated: fresh.map((entry) => entry.id),
    kept,
    missing,
    quotes,
    calls,
  });
  if (todo.length === 0) return finish([], { given: 0, located: 0 }, 0, []);

  const ids = todo.map((scene) => scene.id);
  const messages = annotationPrompt(chapter, chapterText, scenes, ids, options);
  const attempts = options.attempts ?? 2;
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    options.onCall?.(ids, attempt);
    const reply = await complete(messages);
    const result = parseAnnotationReply(reply, ids);
    if (result.ok) {
      let given = 0;
      let located = 0;
      const fresh = result.scenes.map((proposed) => {
        const scene = todo.find((entry) => entry.id === proposed.id)!;
        const grounded = groundScene(proposed, sceneBody(chapterText, scene), {
          chapter, scene: scene.index + 1, annotator: options.annotator, sceneHash: hashes.get(scene.id)!,
        });
        given += grounded.quotes.given;
        located += grounded.quotes.located;
        return grounded.annotation;
      });
      const done = new Set(fresh.map((entry) => entry.id));
      return finish(fresh, { given, located }, attempt, ids.filter((id) => !done.has(id)));
    }
    lastError = result.error;
    messages.push(
      { role: "assistant", content: reply },
      { role: "user", content: `That reply could not be used: ${result.error}. Reply again with only the JSON object.` },
    );
  }
  throw new Error(`Could not annotate chapter ${chapter} after ${attempts} attempts: ${lastError}`);
}
