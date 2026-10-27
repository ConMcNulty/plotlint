import { findDefinitions, stateAt, type Definition, type EntityAtCursor } from "@plotlint/rules";
import { chapterTexts } from "./plotlint-chapters.js";
import { bookSnapshot } from "./plotlint-lint.js";

/**
 * IDE-style navigation for the Studio editor: the world as of the cursor (state
 * at cursor) and where a name is first established (go to definition), over the
 * book's runtime state and its chapter files. Evidence offsets are into the
 * chapter file text, which is what the editor shows; the open chapter's unsaved
 * text, when sent, stands in for its file.
 */

export interface StateAtCursorResult {
  readonly chapter: number;
  readonly offset: number;
  readonly entities: EntityAtCursor[];
  /** The book has no runtime state yet. */
  readonly stateMissing: boolean;
}

export interface DefinitionResult {
  readonly name: string;
  /** First the passage that establishes the name, then later facts about it, in reading order. */
  readonly definitions: Definition[];
  readonly stateMissing: boolean;
}

export async function stateAtCursor(request: { bookDir: string; chapter: number; offset: number; text?: string }): Promise<StateAtCursorResult> {
  const { bookDir, chapter, text } = request;
  const [snapshot, chapters] = await Promise.all([
    bookSnapshot(bookDir),
    chapterTexts(bookDir, text === undefined ? undefined : { chapter, text }),
  ]);
  const offset = Math.min(request.offset, chapters.get(chapter)?.length ?? request.offset);
  return {
    chapter,
    offset,
    entities: snapshot ? stateAt(snapshot, { chapter, offset }, chapters) : [],
    stateMissing: snapshot === null,
  };
}

/** Definitions of a name as the state spells it, or else of the subjects whose names contain it. */
export async function definitionsOf(request: { bookDir: string; name: string; chapter?: number; text?: string }): Promise<DefinitionResult> {
  const { bookDir, name, chapter, text } = request;
  const [snapshot, chapters] = await Promise.all([
    bookSnapshot(bookDir),
    chapterTexts(bookDir, chapter === undefined || text === undefined ? undefined : { chapter, text }),
  ]);
  if (!snapshot) return { name, definitions: [], stateMissing: true };
  const exact = findDefinitions(snapshot, name, chapters);
  if (exact.length > 0) return { name, definitions: exact, stateMissing: false };
  // Prose uses short names: "Harrow" for "Aurel Harrow", "Okonkwo-Hale" for "Mira Okonkwo-Hale".
  const definitions = subjectsNamed(snapshot.currentState.facts.map((fact) => fact.subject), name)
    .flatMap((subject) => findDefinitions(snapshot, subject, chapters).filter((definition) => definition.role === "subject"));
  return { name, definitions, stateMissing: false };
}

const nameWords = (value: string) => value.toLowerCase().split(/[\s\-‐–]+/u).filter(Boolean);

/** Subjects whose name contains every word of `name` as a whole word, e.g. "Harrow" → "Aurel Harrow". */
export function subjectsNamed(subjects: ReadonlyArray<string>, name: string): string[] {
  const wanted = nameWords(name);
  if (wanted.length === 0) return [];
  return [...new Set(subjects)]
    .filter((subject) => {
      const words = nameWords(subject);
      return words.length > wanted.length && wanted.every((word) => words.includes(word));
    })
    .sort((a, b) => a.localeCompare(b));
}

const MAX_TEXT = 2_000_000;
const MAX_NAME = 200;

const isChapter = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Parse and validate a state-at-cursor request body; returns an error message for a bad one. */
export function parseStateBody(body: unknown): { bookId: string; chapter: number; offset: number; text?: string } | string {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  const { bookId, chapter, offset, text } = body as Record<string, unknown>;
  if (typeof bookId !== "string") return "bookId must be a string";
  if (!isChapter(chapter)) return "chapter must be a non-negative integer";
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) return "offset must be a non-negative integer";
  if (text === undefined || text === null) return { bookId, chapter, offset };
  if (typeof text !== "string") return "text must be a string";
  if (text.length > MAX_TEXT) return `text is longer than ${MAX_TEXT} characters`;
  if (offset > text.length) return "offset must be within the text";
  return { bookId, chapter, offset, text };
}

/** Parse and validate a go-to-definition request body; `text` is the unsaved text of `chapter`. */
export function parseDefinitionBody(body: unknown): { bookId: string; name: string; chapter?: number; text?: string } | string {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  const { bookId, name, chapter, text } = body as Record<string, unknown>;
  if (typeof bookId !== "string") return "bookId must be a string";
  if (typeof name !== "string" || !name.trim()) return "name must be a non-empty string";
  if (name.length > MAX_NAME) return `name is longer than ${MAX_NAME} characters`;
  if (chapter !== undefined && chapter !== null && !isChapter(chapter)) return "chapter must be a non-negative integer";
  if (text !== undefined && text !== null) {
    if (typeof text !== "string") return "text must be a string";
    if (!isChapter(chapter)) return "text needs the chapter it belongs to";
    if (text.length > MAX_TEXT) return `text is longer than ${MAX_TEXT} characters`;
    return { bookId, name: name.trim(), chapter, text };
  }
  return { bookId, name: name.trim(), ...(isChapter(chapter) ? { chapter } : {}) };
}
