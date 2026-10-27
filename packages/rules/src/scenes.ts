import type { Diagnostic } from "@plotlint/diagnostics";

/**
 * Deterministic scene segmentation for one chapter of manuscript text.
 *
 * Browser-safe (no Node APIs) so the editor can segment as the writer types.
 *
 * Conventions:
 * - Scenes are contiguous and cover the whole text: scene 1 starts at 0, each
 *   scene ends where the next starts, and the last ends at `text.length`.
 * - A break line (marker or heading, with its line ending) belongs to the scene
 *   it opens: `scene.start` is the start of that line and `scene.bodyStart` is
 *   just after it. `breakMarker` records the line's exact range.
 * - No empty scenes. A break with no prose since the previous break (leading,
 *   consecutive or trailing breaks) does not open a scene; leading and
 *   consecutive breaks are folded into the scene that follows them, trailing
 *   breaks into the scene before them.
 * - The chapter title (the first heading before any prose, when it is level 1 or
 *   reads like "第N章" / "Chapter N") and a front-matter block opened by `---`
 *   on the first line are not breaks. Every other markdown heading opens a scene.
 */

/** How a scene boundary was found: an explicit marker or heading, or a suggested time/place transition. */
export type SceneBreakKind = "hard" | "soft";

export interface SceneBreak {
  readonly kind: SceneBreakKind;
  /** The break line for a hard break; the transition phrase for a soft break. */
  readonly start: number;
  readonly end: number;
  /** The trimmed marker line (e.g. `* * *`, `## The docks`) or the matched transition phrase. */
  readonly text: string;
}

export interface Scene {
  /** `ch<chapter>.s<n>`, with n counted from 1. */
  readonly id: string;
  /** 0-based position in the chapter, so `id` uses `index + 1`. */
  readonly index: number;
  readonly start: number;
  readonly end: number;
  /** Where the scene's prose begins: after its break line, or `start` when it has none or the break is soft. */
  readonly bodyStart: number;
  /** `hard` for the first scene and for scenes opened by a marker or heading; `soft` for suggested breaks. */
  readonly kind: SceneBreakKind;
  /** Text of the markdown heading that opened the scene. */
  readonly heading?: string;
  readonly breakMarker?: SceneBreak;
}

export interface SegmentScenesOptions {
  readonly chapter: number;
  /** Also propose breaks at time/place transitions ("Three days later", "三天后"). Off by default. */
  readonly softBreaks?: boolean;
}

interface Line {
  readonly start: number;
  /** End including the line terminator. */
  readonly end: number;
  readonly content: string;
}

// Marker lines, matched against the trimmed line. Repeated characters may be spaced out ("* * *").
const MARKER_PATTERNS: ReadonlyArray<RegExp> = [
  /^(?:[*＊]\s*){3,}$/u,
  /^(?:-\s*){3,}$/u,
  /^(?:_\s*){3,}$/u,
  /^(?:[=＝]\s*){3,}$/u,
  /^(?:[~～]\s*){3,}$/u,
  /^(?:#\s*)+$/u,
  /^(?:§\s*)+$/u,
  /^(?:※\s*)+$/u,
  /^(?:[◇◆○●☆★□■◎]\s*)+$/u,
  // A lone "……" or "——" is usually a beat of silence or an interrupted line, so
  // only runs of three pairs or more count as breaks, as Chinese web fiction uses them.
  /^(?:…\s*){6,}$/u,
  /^(?:[—─━]\s*){6,}$/u,
];

const HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u;
const CHAPTER_TITLE = /^(?:第[零〇○Ｏ０-９一二三四五六七八九十百千万两\d]+[章回]|chapter\s+(?:\d+|[ivxlcdm]+)\b)/iu;

const EN_NUMBER = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a few|a couple of|several|many|some|\\d+)";
const EN_UNIT = "(?:minutes?|hours?|days?|nights?|weeks?|months?|years?|decades?)";
const EN_PART = "(?:morning|afternoon|evening|night|day|week|month|year|spring|summer|autumn|fall|winter)";
const SOFT_EN = new RegExp(
  `^(?:${EN_NUMBER} ${EN_UNIT} (?:later|after(?:wards?)?|passed)|(?:The|By the) (?:next|following) ${EN_PART}|(?:Later|Early|Late) (?:that|the same) ${EN_PART}|That (?:same )?${EN_PART}|Meanwhile|Elsewhere|Across (?:town|the city)|Back at)\\b`,
  "iu",
);
const ZH_NUMBER = "(?:[一二三四五六七八九十百两几数半\\d０-９]+)";
const ZH_PART = "(?:夜里|晚上|夜晚|深夜|半夜|清晨|早上|上午|中午|下午|傍晚|黄昏)";
const SOFT_ZH = new RegExp(
  `^(?:${ZH_NUMBER}(?:个)?(?:分钟|刻钟|小时|个时辰|时辰|天|日|周|星期|个月|月|年)(?:后|之后|以后|过去了?)|次日|翌日|第二天|隔天|隔日|第二日|(?:那天|当天|这天|那日|当日|次日)${ZH_PART}|当晚|当夜|那晚|那夜|是夜|入夜|与此同时|另一边|另一头)`,
  "u",
);
// Paragraphs in CJK manuscripts are often separated by a single newline, so a line also
// starts a paragraph when the line before it ends a sentence.
const SENTENCE_END = /[.!?。！？…”"」』）)]$/u;

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < text.length) {
    let cursor = start;
    while (cursor < text.length && text[cursor] !== "\n" && text[cursor] !== "\r") cursor++;
    const contentEnd = cursor;
    if (text[cursor] === "\r" && text[cursor + 1] === "\n") cursor += 2;
    else if (cursor < text.length) cursor += 1;
    lines.push({ start, end: cursor, content: text.slice(start, contentEnd) });
    start = cursor;
  }
  return lines;
}

/** Lines of a YAML front-matter block that opens the text, or 0 when there is none. */
function frontMatterLines(lines: ReadonlyArray<Line>): number {
  if (lines[0]?.content !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.content === "---" || lines[i]!.content === "...") return i + 1;
  }
  return 0;
}

function isMarker(trimmed: string): boolean {
  return MARKER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function softCue(trimmed: string): string | undefined {
  const body = trimmed.replace(/^[\s　]+/u, "");
  return SOFT_ZH.exec(body)?.[0] ?? SOFT_EN.exec(body)?.[0];
}

interface Draft {
  start: number;
  bodyStart: number;
  kind: SceneBreakKind;
  heading?: string;
  breakMarker?: SceneBreak;
  hasProse: boolean;
}

/** Split one chapter's text into scenes at explicit breaks (and optionally suggested soft breaks). */
export function segmentScenes(text: string, options: SegmentScenesOptions): Scene[] {
  const lines = splitLines(text);
  const drafts: Draft[] = [{ start: 0, bodyStart: 0, kind: "hard", hasProse: false }];
  const skip = frontMatterLines(lines);
  let titleSeen = false;
  let previousLine = "";

  for (let i = skip; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.content.trim();
    const current = drafts[drafts.length - 1]!;
    const before = previousLine;
    previousLine = trimmed;
    if (!trimmed) continue;

    const headingMatch = isMarker(trimmed) ? undefined : HEADING.exec(trimmed);
    const proseSoFar = drafts.some((draft) => draft.hasProse);
    if (headingMatch && !titleSeen && !proseSoFar && (headingMatch[1] === "#" || CHAPTER_TITLE.test(headingMatch[2]!))) {
      titleSeen = true;
      continue;
    }

    if (headingMatch || isMarker(trimmed)) {
      const breakMarker: SceneBreak = { kind: "hard", start: line.start, end: line.end, text: trimmed };
      const heading = headingMatch?.[2];
      if (current.hasProse) {
        drafts.push({ start: line.start, bodyStart: line.end, kind: "hard", breakMarker, hasProse: false, ...(heading ? { heading } : {}) });
      } else {
        // No prose since the last break: fold this break into the scene it precedes.
        current.breakMarker = breakMarker;
        current.bodyStart = line.end;
        if (heading) current.heading = heading;
      }
      continue;
    }

    const cue = options.softBreaks && current.hasProse && (!before || SENTENCE_END.test(before)) ? softCue(line.content) : undefined;
    if (cue) {
      const cueStart = line.start + line.content.indexOf(cue);
      drafts.push({
        start: line.start, bodyStart: line.start, kind: "soft", hasProse: true,
        breakMarker: { kind: "soft", start: cueStart, end: cueStart + cue.length, text: cue },
      });
      continue;
    }
    current.hasProse = true;
  }

  // Trailing breaks with no prose after them belong to the scene before.
  while (drafts.length > 1 && !drafts[drafts.length - 1]!.hasProse) drafts.pop();

  return drafts.map((draft, index) => ({
    id: `ch${options.chapter}.s${index + 1}`,
    index,
    start: draft.start,
    end: drafts[index + 1]?.start ?? text.length,
    bodyStart: draft.bodyStart,
    kind: draft.kind,
    ...(draft.heading === undefined ? {} : { heading: draft.heading }),
    ...(draft.breakMarker === undefined ? {} : { breakMarker: draft.breakMarker }),
  }));
}

/** The scene containing `offset`; an offset at the very end of the text falls in the last scene. */
export function sceneAt(scenes: ReadonlyArray<Scene>, offset: number): Scene | undefined {
  let low = 0;
  let high = scenes.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const scene = scenes[middle]!;
    if (offset < scene.start) high = middle - 1;
    else if (offset >= scene.end) low = middle + 1;
    else return scene;
  }
  const last = scenes[scenes.length - 1];
  return last && offset === last.end ? last : undefined;
}

/** Scenes that share at least one character with `[start, end)`; an empty range returns the scene at `start`. */
export function scenesOverlapping(scenes: ReadonlyArray<Scene>, start: number, end: number): Scene[] {
  if (end <= start) {
    const scene = sceneAt(scenes, start);
    return scene ? [scene] : [];
  }
  return scenes.filter((scene) => scene.start < end && start < scene.end);
}

/** The id of the scene where a diagnostic's range starts, or undefined when it has no range. */
export function diagnosticScene(diagnostic: Pick<Diagnostic, "range">, scenes: ReadonlyArray<Scene>): string | undefined {
  return diagnostic.range ? sceneAt(scenes, diagnostic.range.start)?.id : undefined;
}
