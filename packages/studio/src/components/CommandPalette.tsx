import { useEffect, useMemo, useState } from "react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { fetchJson, postApi, useApi } from "../hooks/use-api";
import type { HashRoute } from "../hooks/use-hash-route";
import type { TFunction } from "../hooks/use-i18n";
import { chapterQuery, paletteCommands, type PaletteCommand, type PaletteGroup, type PaletteNav } from "./command-palette";

const GROUPS: ReadonlyArray<PaletteGroup> = ["run", "book", "export", "go", "books"];

/** Ctrl/Cmd+K (or Ctrl/Cmd+Shift+P): run any command by name. */
export function CommandPalette({ route, nav, t }: { route: HashRoute; nav: PaletteNav; t: TFunction }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data } = useApi<{ books: ReadonlyArray<{ id: string; title: string }> }>("/books");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && (key === "k" || (event.shiftKey && key === "p"))) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo(() => paletteCommands({
    route,
    books: data?.books ?? [],
    nav,
    t,
    actions: {
      writeNext: async (bookId) => {
        nav.toBook(bookId);
        try { await postApi(`/books/${bookId}/write-next`); } catch (error) { alert(error instanceof Error ? error.message : String(error)); }
      },
      audit: async (bookId, chapter) => {
        try {
          const review = await fetchJson<{ summary?: string; observations?: unknown[] }>(`/books/${bookId}/audit/${chapter}`, { method: "POST" });
          alert(`${review.summary ?? t("book.review")}\n${review.observations?.length ?? 0} ${t("book.observations")}`);
        } catch (error) {
          alert(error instanceof Error ? error.message : String(error));
        }
      },
      download: (url) => { window.location.href = url; },
    },
  }), [route, data, nav, t]);

  const bookId = "bookId" in route ? route.bookId : undefined;
  const chapter = bookId ? chapterQuery(query) : null;
  const run = (command: Pick<PaletteCommand, "run">) => {
    setOpen(false);
    setQuery("");
    void command.run();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("palette.title")} description={t("palette.hint")}>
      <Command>
        <CommandInput placeholder={t("palette.placeholder")} value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{t("palette.empty")}</CommandEmpty>
          {chapter !== null && bookId && (
            <CommandGroup heading={t("palette.group.book")} forceMount>
              <CommandItem value={`open chapter ${query}`} forceMount onSelect={() => run({ run: () => nav.toChapter(bookId, chapter) })}>
                {t("palette.openChapter")} {chapter}
              </CommandItem>
            </CommandGroup>
          )}
          {GROUPS.map((group) => {
            const items = commands.filter((command) => command.group === group);
            if (!items.length) return null;
            return (
              <CommandGroup key={group} heading={t(`palette.group.${group}` as const)}>
                {items.map((command) => (
                  <CommandItem key={command.id} value={command.id} keywords={[command.title, ...(command.keywords ?? [])]} onSelect={() => run(command)}>
                    {command.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
