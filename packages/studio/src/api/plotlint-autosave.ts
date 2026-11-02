/**
 * plotlint: Studio saves the open chapter as the writer types, so every pause
 * would otherwise leave a version behind. A save keeps the text it replaces as a
 * version only when no version of the writer's from the last stretch of work
 * already holds an earlier state of it.
 */

/** How long one stretch of writing lasts for versioning: autosaves within it share one version. */
export const AUTOSAVE_VERSION_WINDOW_MS = 15 * 60 * 1000;

export interface VersionStamp {
  readonly source: string;
  readonly createdAt: string;
}

/** Whether a save should archive the text it replaces; `versions` are newest first. */
export function archiveOnSave(
  versions: ReadonlyArray<VersionStamp>,
  autosave: boolean,
  now: Date = new Date(),
): boolean {
  if (!autosave) return true;
  const latest = versions[0];
  if (!latest || latest.source !== "manual") return true;
  const age = now.getTime() - new Date(latest.createdAt).getTime();
  return !(age >= 0 && age < AUTOSAVE_VERSION_WINDOW_MS);
}

/** The file text a save of `content` writes, as the edit transaction normalises it. */
export function savedChapterText(content: string): string {
  const trimmed = content.trim();
  return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}

/** Whether saving `content` over the file text `before` would change nothing but line endings. */
export function unchangedBySave(content: string, before: string): boolean {
  const lf = (text: string) => text.replace(/\r\n?/g, "\n");
  return savedChapterText(lf(content)) === savedChapterText(lf(before));
}
