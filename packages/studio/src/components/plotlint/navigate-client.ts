import type { Definition, EntityAtCursor, EvidenceLocation } from "@plotlint/rules";
import { fetchJson } from "../../hooks/use-api";

export type { Definition, EntityAtCursor, EvidenceLocation };

export interface StateAtCursorResponse {
  readonly chapter: number;
  readonly offset: number;
  readonly entities: EntityAtCursor[];
  readonly stateMissing: boolean;
}

export interface DefinitionResponse {
  readonly name: string;
  readonly definitions: Definition[];
  readonly stateMissing: boolean;
}

/** The world as of `offset` in `chapter`, whose current (possibly unsaved) text is `text`. */
export function fetchStateAt(bookId: string, chapter: number, offset: number, text: string): Promise<StateAtCursorResponse> {
  return fetchJson<StateAtCursorResponse>("/plotlint/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId, chapter, offset, text }),
  });
}

/**
 * Where the first of `names` that the state knows is established, reading the
 * open chapter's unsaved text. Names are tried in order, so pass the best guess
 * first ("Mira Vale" before "Vale"). Null when none of them resolves.
 */
export async function findDefinition(
  bookId: string,
  names: ReadonlyArray<string>,
  open: { chapter: number; text: string },
): Promise<{ name: string; definitions: Definition[] } | null> {
  for (const name of names) {
    const result = await fetchJson<DefinitionResponse>("/plotlint/definition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, name, chapter: open.chapter, text: open.text }),
    });
    if (result.definitions.length > 0) return { name, definitions: result.definitions };
  }
  return null;
}
