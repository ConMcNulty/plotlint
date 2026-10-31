import { fetchJson } from "../../hooks/use-api";

/** Characters around the cursor sent for ghost text; the server trims to the same. */
const BEFORE = 4_000;
const AFTER = 400;

/** A few words that could come next at `offset` in the open chapter, or null. */
export async function fetchContinuation(bookId: string, text: string, offset: number): Promise<string | null> {
  const result = await fetchJson<{ text: string | null }>("/plotlint/continue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId, before: text.slice(Math.max(0, offset - BEFORE), offset), after: text.slice(offset, offset + AFTER) }),
  });
  return result.text;
}
