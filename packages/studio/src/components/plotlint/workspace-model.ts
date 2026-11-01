// The book workspace puts the manuscript in the centre (PLAN, "Centre: editor").
// The chat with the author agent and the book's notes share one side panel
// that the writer opens when they want it and closes to get back to the page.

export type SidePanelTab = "chat" | "book";

export interface SidePanelState {
  readonly open: boolean;
  readonly tab: SidePanelTab;
}

export const SIDE_PANEL_STORAGE_KEY = "plotlint.workspace.sidePanel";

/**
 * The panel a book opens with. A saved choice wins; with none, a book that has
 * chapters opens on the text alone, and a book without any opens the chat,
 * since asking the author agent is how its first chapter gets written.
 */
export function initialSidePanel(saved: string | null, chapterCount: number): SidePanelState {
  const parsed = parseSidePanel(saved);
  if (parsed) return parsed;
  return { open: chapterCount === 0, tab: "chat" };
}

export function parseSidePanel(saved: string | null): SidePanelState | null {
  if (!saved) return null;
  try {
    const value = JSON.parse(saved) as Partial<SidePanelState>;
    if (typeof value.open !== "boolean" || (value.tab !== "chat" && value.tab !== "book")) return null;
    return { open: value.open, tab: value.tab };
  } catch {
    return null;
  }
}

/** The chapter a book opens on: the one asked for if the book has it, else the latest. */
export function chapterToOpen(chapters: ReadonlyArray<{ readonly number: number }>, requested?: number): number | null {
  if (chapters.length === 0) return requested ?? null;
  if (requested !== undefined && chapters.some((chapter) => chapter.number === requested)) return requested;
  return Math.max(...chapters.map((chapter) => chapter.number));
}

/** The chapters either side of `current`, for previous/next buttons. */
export function neighbours(chapters: ReadonlyArray<{ readonly number: number }>, current: number): { previous: number | null; next: number | null } {
  const numbers = chapters.map((chapter) => chapter.number).sort((a, b) => a - b);
  const previous = numbers.filter((number) => number < current).at(-1) ?? null;
  const next = numbers.find((number) => number > current) ?? null;
  return { previous, next };
}
