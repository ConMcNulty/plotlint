import type { CurrentStateFact, RuntimeStateSnapshot } from "@actalk/inkos-core";
import type { Diagnostic } from "@plotlint/diagnostics";
import type { FrameEntry, FrameKind, FramesFile } from "./book.js";
import { locateEvidence, type ChapterTexts } from "./evidence.js";
import { sceneAt, segmentScenes } from "./scenes.js";

// Frames: flashbacks, dreams, stories told inside the story and unreliable
// narrators. A frame is set per chapter or per scene in `frames.json`, or by a
// marker comment anywhere in a scene's text:
//
//   <!-- plotlint frame: flashback -->
//   <!-- plotlint frame: unreliable pov=Tomas -->
//
// A fact takes the frame of the scene its evidence passage is in, else the frame
// of its chapter, else the main timeline. Rules then see only main-timeline facts,
// plus unreliable-narrator facts; a finding that rests on an unreliable account is
// downgraded to a note, since the contradiction may be the point.

/** Frames whose facts are not the story's present, so continuity rules skip them. */
export const OFF_TIMELINE: ReadonlySet<FrameKind> = new Set(["flashback", "dream", "story"]);

const MARKER = /<!--\s*plotlint\s+frame\s*:\s*(main|flashback|dream|story|unreliable)(?:\s+pov\s*=\s*("[^"]+"|[^\s>]+))?\s*-->/giu;

/** Frame markers written in a chapter's text, keyed by 1-based scene number. */
export function frameMarkers(text: string, chapter: number): FrameEntry[] {
  const scenes = segmentScenes(text, { chapter });
  const entries: FrameEntry[] = [];
  for (const match of text.matchAll(MARKER)) {
    const scene = sceneAt(scenes, match.index);
    if (!scene) continue;
    const pov = match[2]?.replace(/^"|"$/gu, "");
    entries.push({ chapter, scene: scene.index + 1, frame: match[1]!.toLowerCase() as FrameKind, ...(pov ? { pov } : {}) });
  }
  return entries;
}

export interface FrameResolver {
  /** The frame entry a fact falls in, or undefined for the main timeline. */
  frameOf(fact: CurrentStateFact): FrameEntry | undefined;
  /** True when any chapter or scene is outside the main timeline. */
  readonly any: boolean;
}

export function frameResolver(frames: FramesFile | undefined, chapters: ChapterTexts | undefined): FrameResolver {
  const byChapter = new Map<number, FrameEntry>();
  const byScene = new Map<string, FrameEntry>();
  const add = (entry: FrameEntry) => {
    if (entry.scene === undefined) byChapter.set(entry.chapter, entry);
    else byScene.set(`ch${entry.chapter}.s${entry.scene}`, entry);
  };
  // Markers in the text override the file, being closer to the prose.
  for (const entry of frames?.frames ?? []) add(entry);
  for (const [chapter, text] of chapters ?? []) frameMarkers(text, chapter).forEach(add);

  const sceneChapters = new Set([...byScene.values()].map((entry) => entry.chapter));
  const cache = new Map<CurrentStateFact, FrameEntry | undefined>();
  const resolve = (fact: CurrentStateFact): FrameEntry | undefined => {
    if (sceneChapters.has(fact.sourceChapter) && chapters) {
      const scene = locateEvidence(fact.evidence, fact.sourceChapter, chapters).location?.scene;
      const entry = scene === undefined ? undefined : byScene.get(scene);
      if (entry) return entry.frame === "main" ? undefined : entry;
    }
    const entry = byChapter.get(fact.sourceChapter);
    return entry?.frame === "main" ? undefined : entry;
  };
  return {
    any: [...byChapter.values(), ...byScene.values()].some((entry) => entry.frame !== "main"),
    frameOf(fact) {
      if (!cache.has(fact)) cache.set(fact, resolve(fact));
      return cache.get(fact);
    },
  };
}

/** The snapshot without facts from flashback, dream and story-within-story scenes. */
export function mainTimeline(snapshot: RuntimeStateSnapshot, frames: FrameResolver): RuntimeStateSnapshot {
  if (!frames.any) return snapshot;
  const facts = snapshot.currentState.facts.filter((fact) => !OFF_TIMELINE.has(frames.frameOf(fact)?.frame ?? "main"));
  return { ...snapshot, currentState: { ...snapshot.currentState, facts } };
}

const factKey = (fact: CurrentStateFact) =>
  [fact.subject, fact.predicate, fact.object, fact.validFromChapter, fact.validUntilChapter, fact.sourceChapter].join("\u0000");

/** Downgrade findings that cite a fact from an unreliable narrator's account to notes. */
export function downgradeUnreliable(diagnostics: Diagnostic[], snapshot: RuntimeStateSnapshot, frames: FrameResolver): Diagnostic[] {
  if (!frames.any) return diagnostics;
  const unreliable = new Map<string, FrameEntry>();
  for (const fact of snapshot.currentState.facts) {
    const entry = frames.frameOf(fact);
    if (entry?.frame === "unreliable") unreliable.set(factKey(fact), entry);
  }
  if (unreliable.size === 0) return diagnostics;
  return diagnostics.map((diagnostic) => {
    const entry = diagnostic.facts?.map((fact) => unreliable.get(factKey(fact))).find(Boolean);
    if (!entry) return diagnostic;
    const where = `ch${entry.chapter}${entry.scene === undefined ? "" : `.s${entry.scene}`}`;
    return {
      ...diagnostic,
      severity: "note",
      evidence: [...diagnostic.evidence, `frame: unreliable narrator${entry.pov ? ` (${entry.pov})` : ""} in ${where}, so this may be deliberate`],
    };
  });
}
