/** The continuous manuscript: every chapter in one scroll, the one being edited open in the editor. */

/** Where each line starts in the chapter text the lines were split from (on "\n"). */
export function lineStarts(lines: ReadonlyArray<string>): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  return starts;
}

/** The chapter text offset of `column` within line `index`, kept inside that line. */
export function offsetInLines(starts: ReadonlyArray<number>, index: number, column: number): number {
  if (index < 0 || index >= starts.length) return 0;
  const start = starts[index]!;
  const next = starts[index + 1];
  const length = next === undefined ? Number.POSITIVE_INFINITY : next - start - 1;
  return start + Math.max(0, Math.min(column, length));
}

/** A chapter's heading in the manuscript: its title, or "Chapter n" without one. */
export function passageTitle(chapter: { readonly number: number; readonly title: string }, fallback: string): string {
  return chapter.title.trim() || fallback.replace("{n}", String(chapter.number));
}
