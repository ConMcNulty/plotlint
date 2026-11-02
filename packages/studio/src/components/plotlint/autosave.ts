/**
 * Saves the open chapter as the writer works, so moving to another chapter
 * never asks whether to keep the edits: like one document, the text is
 * always kept. Edits are saved a moment after typing stops, and at once when
 * the writer leaves the chapter (`flush`). Saves run one at a time, in order.
 */

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

export interface AutosaverOptions {
  /** The text on disk when the chapter opened. */
  readonly saved: string;
  /** The editor's text now. */
  readonly read: () => string;
  /** Write `text` to the chapter file; `autosave` is false for an explicit save (Ctrl/Cmd+S). */
  readonly write: (text: string, autosave: boolean) => Promise<void>;
  readonly onStatus?: (status: SaveStatus, error?: string) => void;
  /** Pause after the last edit before saving. */
  readonly delayMs?: number;
}

export const AUTOSAVE_DELAY_MS = 1000;

/**
 * Whether two chapter texts save to the same file: the server trims the text and
 * ends it with one newline, and a file written on Windows may use CRLF.
 */
export function sameChapterText(a: string, b: string): boolean {
  const normal = (text: string) => text.replace(/\r\n?/g, "\n").trim();
  return a === b || normal(a) === normal(b);
}

export class ChapterAutosaver {
  private saved: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<boolean> = Promise.resolve(true);
  private paused = false;
  private disposed = false;
  private status: SaveStatus = "saved";

  constructor(private readonly options: AutosaverOptions) {
    this.saved = options.saved;
  }

  /** The text last written (or found) on disk. */
  get savedText(): string {
    return this.saved;
  }

  get currentStatus(): SaveStatus {
    return this.status;
  }

  isDirty(): boolean {
    return !sameChapterText(this.options.read(), this.saved);
  }

  /** The editor changed: save after a pause, unless paused (an agent's edit under review). */
  changed(): void {
    if (this.disposed) return;
    if (!this.isDirty()) {
      this.clearTimer();
      if (this.status === "unsaved") this.setStatus("saved");
      return;
    }
    if (this.status !== "saving") this.setStatus("unsaved");
    if (this.paused) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.save(true);
    }, this.options.delayMs ?? AUTOSAVE_DELAY_MS);
  }

  /** Hold or resume the timed saves; a flush still saves. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.clearTimer();
    else this.changed();
  }

  /** Record text written to disk by other means (a review finished, the editor reopened on the file). */
  markSaved(text: string): void {
    this.saved = text;
    this.changed();
  }

  /** Save now if there is anything to save; resolves false when the save failed. */
  flush(autosave = true): Promise<boolean> {
    this.clearTimer();
    return this.save(autosave);
  }

  /** Stop the timer; pending edits are left to a final `flush` or `saveOnExit`. */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private save(autosave: boolean): Promise<boolean> {
    this.chain = this.chain.then(async () => {
      const text = this.options.read();
      if (sameChapterText(text, this.saved)) {
        if (this.status !== "saved") this.setStatus("saved");
        return true;
      }
      this.setStatus("saving");
      try {
        await this.options.write(text, autosave);
        this.saved = text;
        // Typing during the save leaves more to save.
        if (!sameChapterText(this.options.read(), this.saved)) {
          this.setStatus("unsaved");
          if (!this.paused && !this.disposed) this.changed();
        } else {
          this.setStatus("saved");
        }
        return true;
      } catch (error) {
        this.setStatus("error", error instanceof Error ? error.message : String(error));
        return false;
      }
    });
    return this.chain;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private setStatus(status: SaveStatus, error?: string): void {
    this.status = status;
    this.options.onStatus?.(status, error);
  }
}
