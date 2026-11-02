import { useEffect, useRef, useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import type { TFunction } from "../../hooks/use-i18n";
import { lineStarts, offsetInLines } from "./manuscript-model";

/** Where a click in a passage landed: the text offset, and how far down the window it was. */
export interface PassageClick {
  readonly offset: number;
  readonly clientY: number;
}

/** How far outside the window a chapter's text starts loading. */
const LOAD_MARGIN = "1500px 0px";

/**
 * A chapter of the continuous manuscript that is not the one being edited:
 * its text as saved, set like the editor's, loaded as it scrolls near. A click
 * opens the editor on it at the clicked place.
 */
export function ChapterPassage({ bookId, chapterNumber, title, t, onActivate }: {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly t: TFunction;
  readonly onActivate: (click: PassageClick) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, { root: scrollParent(element), rootMargin: LOAD_MARGIN });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    fetchJson<{ content: string }>(`/books/${encodeURIComponent(bookId)}/chapters/${chapterNumber}`)
      .then((data) => { if (!cancelled) setText(data.content); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [near, bookId, chapterNumber]);

  const lines = text === null ? [] : text.split("\n");
  const starts = lineStarts(lines);

  const onClick = (event: React.MouseEvent) => {
    // Selecting text to copy is not a request to edit.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && ref.current?.contains(selection.anchorNode)) return;
    onActivate({ offset: text === null ? 0 : clickOffset(event, starts), clientY: event.clientY });
  };

  return (
    <section
      ref={ref}
      data-testid="chapter-passage"
      data-chapter={chapterNumber}
      tabIndex={0}
      title={t("manuscript.clickToEdit")}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.target !== event.currentTarget) return;
        event.preventDefault();
        onActivate({ offset: 0, clientY: ref.current?.getBoundingClientRect().top ?? 0 });
      }}
      className="paper-sheet group relative cursor-text rounded-2xl p-6 shadow-2xl shadow-primary/5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 md:p-10 xl:p-14"
    >
      <header className="mb-8 text-center">
        <h2 className="font-sans text-3xl font-medium leading-tight tracking-tight text-foreground md:text-4xl">{title}</h2>
        <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
          {t("reader.manuscriptPage")} · {chapterNumber.toString().padStart(2, "0")}
        </div>
      </header>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : text === null ? (
        <div className="min-h-[60vh]" aria-busy="true" />
      ) : (
        <div className="pl-manuscript-passage font-sans text-lg leading-[1.8] text-foreground/90" data-testid="passage-text">
          {lines.map((line, index) => (
            <p key={index} data-start={starts[index]}>{line}</p>
          ))}
        </div>
      )}
    </section>
  );
}

/** The nearest ancestor that scrolls: a margin on the window alone would not reach past its edge. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}

/** The chapter text offset under a click, from the line it hit and the character within it. */
function clickOffset(event: React.MouseEvent, starts: ReadonlyArray<number>): number {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  const element = node instanceof Element ? node : node?.parentElement;
  const line = element?.closest<HTMLElement>("p[data-start]");
  if (!line) {
    // Between lines or on the heading: the nearest line above, else the start.
    const target = (event.target as Element | null)?.closest<HTMLElement>("p[data-start]");
    return target ? Number(target.dataset.start) : 0;
  }
  const index = starts.indexOf(Number(line.dataset.start));
  return offsetInLines(starts, index, node === line ? 0 : offset);
}
