import type { Diagnostic } from "@plotlint/diagnostics";
import type { SceneMarker } from "@plotlint/editor";
// The browser-safe scenes entry: the package root also pulls in Node-only InkOS code.
import { segmentScenes } from "@plotlint/rules/scenes";

// Word counts per scene and chapter, and the margin markers for scene-level
// findings (PLAN, "Centre: editor" and "Gutter markers flag scene-level issues").

export interface SceneCount {
  readonly id: string;
  readonly index: number;
  readonly start: number;
  readonly heading?: string;
  readonly words: number;
}

export interface WritingStats {
  readonly words: number;
  readonly scenes: ReadonlyArray<SceneCount>;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
// Markdown headings and scene-break lines are not prose.
const NOT_PROSE = /^[ \t]*(?:#{1,6}[ \t].*|(?:[*＊\-_=＝~～#§※◇◆○●☆★□■◎…—─━][ \t]*)+)$/gmu;

/** Words in `text`: runs of letters and digits, with each CJK character counted as a word, as word processors do. */
export function countWords(text: string): number {
  const prose = text.replace(NOT_PROSE, "");
  const cjk = prose.match(CJK)?.length ?? 0;
  const rest = prose.replace(CJK, " ").match(WORD)?.length ?? 0;
  return cjk + rest;
}

export function writingStats(text: string, chapter: number): WritingStats {
  const scenes = segmentScenes(text, { chapter }).map((scene): SceneCount => ({
    id: scene.id,
    index: scene.index,
    start: scene.start,
    ...(scene.heading === undefined ? {} : { heading: scene.heading }),
    words: countWords(text.slice(scene.bodyStart, scene.end)),
  }));
  return { words: scenes.reduce((sum, scene) => sum + scene.words, 0), scenes };
}

/** The scene holding plain-text `offset`: the last one starting at or before it. */
export function sceneOf(stats: WritingStats, offset: number): SceneCount | undefined {
  let found: SceneCount | undefined;
  for (const scene of stats.scenes) {
    if (scene.start > offset) break;
    found = scene;
  }
  return found ?? stats.scenes[0];
}

const SEVERITY_RANK = { error: 0, warning: 1, note: 2 } as const;

/** Every scene id (`ch<N>.s<k>`) a finding names in its summary or evidence. */
export function sceneIdsIn(diagnostic: Pick<Diagnostic, "summary" | "evidence">): string[] {
  return [...new Set([diagnostic.summary, ...diagnostic.evidence].flatMap((line) => line.match(/\bch\d+\.s\d+\b/gu) ?? []))];
}

/** Scenes of this chapter a finding names, as `ch<N>.s<k>` in its summary or evidence. */
export function scenesCited(diagnostic: Pick<Diagnostic, "summary" | "evidence">, chapter: number): number[] {
  const found = new Set<number>();
  for (const line of [diagnostic.summary, ...diagnostic.evidence]) {
    for (const match of line.matchAll(/\bch(\d+)\.s(\d+)\b/gu)) {
      if (Number(match[1]) === chapter) found.add(Number(match[2]));
    }
  }
  return [...found];
}

/**
 * One margin marker per scene that unranged findings cite, at the scene's start,
 * with the worst severity among them and their summaries as the title.
 */
export function sceneMarkers(
  diagnostics: ReadonlyArray<Pick<Diagnostic, "summary" | "evidence" | "severity">>,
  stats: WritingStats,
  chapter: number,
): SceneMarker[] {
  const byScene = new Map<number, Array<Pick<Diagnostic, "summary" | "severity">>>();
  for (const diagnostic of diagnostics) {
    for (const scene of scenesCited(diagnostic, chapter)) {
      const list = byScene.get(scene) ?? [];
      list.push(diagnostic);
      byScene.set(scene, list);
    }
  }
  const markers: SceneMarker[] = [];
  for (const scene of stats.scenes) {
    const list = byScene.get(scene.index + 1);
    if (!list) continue;
    const severity = list.map((entry) => entry.severity).sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0]!;
    markers.push({ id: scene.id, offset: scene.start, severity, count: list.length, title: list.map((entry) => entry.summary).join("\n") });
  }
  return markers;
}
