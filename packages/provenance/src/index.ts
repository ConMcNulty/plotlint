import { diffWordsWithSpace } from "diff";
import { z } from "zod";

// Provenance per span (PLAN, "Additional features"): who wrote each passage of a
// chapter. A chapter's record is its text cut into segments, each with the author
// who last wrote it. A revision is diffed word by word against the tracked text:
// words it keeps keep their author, words it inserts take the reviser's. When the
// file on disk no longer matches the tracked text, the difference was made outside
// any recorder and is attributed to "unknown" rather than guessed. The record keeps
// the text itself, so it survives any edit; it never stores offsets on their own.
// Browser-safe: the editor can attribute keystrokes the same way.

/**
 * Who wrote a passage: `human:<name>`, `agent:<name>@<model>`, `import` (text that
 * came in from outside, such as an imported manuscript) or `unknown`.
 */
export const AuthorIdSchema = z.string().regex(/^(?:human(?::[^@\n]+)?|agent:[^@\n]+(?:@[^\n]+)?|import(?::[^\n]+)?|unknown)$/u, "authors are human[:name], agent:<name>[@model], import[:source] or unknown");
export type AuthorId = z.infer<typeof AuthorIdSchema>;
export type AuthorKind = "human" | "agent" | "import" | "unknown";

export const kindOf = (author: AuthorId): AuthorKind => author.split(":")[0]!.split("@")[0] as AuthorKind;

export function humanAuthor(name?: string): AuthorId {
  return name ? `human:${name}` : "human";
}

export function agentAuthor(name: string, model?: string): AuthorId {
  return model ? `agent:${name}@${model}` : `agent:${name}`;
}

export const SegmentSchema = z.object({
  text: z.string().min(1),
  by: AuthorIdSchema,
  /** ISO time of the revision that wrote it. */
  at: z.string().min(1),
  /** What made the change: `loop:<run>`, `studio`, `import`, `cli`. */
  via: z.string().min(1).optional(),
}).strict();
export type Segment = z.infer<typeof SegmentSchema>;

export const ChapterProvenanceSchema = z.object({
  chapter: z.number().int().min(0),
  segments: z.array(SegmentSchema),
}).strict();
export type ChapterProvenance = z.infer<typeof ChapterProvenanceSchema>;

/** `works/<id>/source/story/plotlint/provenance.json`. */
export const ProvenanceFileSchema = z.object({
  version: z.literal(1),
  chapters: z.array(ChapterProvenanceSchema),
}).strict();
export type ProvenanceFile = z.infer<typeof ProvenanceFileSchema>;

export interface Change {
  readonly by: AuthorId;
  readonly at: string;
  readonly via?: string;
}

export const trackedText = (record: ChapterProvenance): string => record.segments.map((segment) => segment.text).join("");

/** Join neighbours written by the same revision, so the record stays small. */
function compact(segments: ReadonlyArray<Segment>): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const last = out[out.length - 1];
    if (last && last.by === segment.by && last.at === segment.at && last.via === segment.via) out[out.length - 1] = { ...last, text: last.text + segment.text };
    else out.push({ ...segment });
  }
  return out;
}

/** Cut `length` characters off the front of `segments`, keeping their authors. */
function take(segments: Segment[], length: number): Segment[] {
  const taken: Segment[] = [];
  while (length > 0 && segments.length) {
    const head = segments[0]!;
    if (head.text.length <= length) {
      taken.push(head);
      segments.shift();
      length -= head.text.length;
    } else {
      taken.push({ ...head, text: head.text.slice(0, length) });
      segments[0] = { ...head, text: head.text.slice(length) };
      length = 0;
    }
  }
  return taken;
}

/** Diff the record's text into `next`: kept words keep their authors, inserted ones are `change`'s. */
function apply(record: ChapterProvenance, next: string, change: Change): ChapterProvenance {
  const rest = record.segments.map((segment) => ({ ...segment }));
  const out: Segment[] = [];
  for (const part of diffWordsWithSpace(trackedText(record), next)) {
    if (part.added) out.push({ text: part.value, by: change.by, at: change.at, ...(change.via ? { via: change.via } : {}) });
    else if (part.removed) take(rest, part.value.length);
    else out.push(...take(rest, part.value.length));
  }
  return { chapter: record.chapter, segments: compact(out) };
}

/**
 * Record a revision of one chapter from `before` to `after` by `change.by`. A chapter
 * with no record yet starts as `before`, written by `baseline` (default unknown). If the
 * tracked text is not `before`, the gap is first recorded as an untracked edit.
 */
export function recordRevision(
  record: ChapterProvenance | undefined,
  chapter: number,
  before: string,
  after: string,
  change: Change,
  baseline: AuthorId = "unknown",
): ChapterProvenance {
  let current = record ?? { chapter, segments: before ? [{ text: before, by: baseline, at: change.at }] : [] };
  if (trackedText(current) !== before) current = apply(current, before, { by: "unknown", at: change.at, via: "untracked" });
  return before === after ? current : apply(current, after, change);
}

/** Bring a record up to the chapter as it is on disk, attributing any difference to `by` (default unknown). */
export function reconcile(record: ChapterProvenance | undefined, chapter: number, text: string, change: Change = { by: "unknown", at: new Date().toISOString(), via: "untracked" }, baseline: AuthorId = "unknown"): ChapterProvenance {
  if (!record) return { chapter, segments: text ? [{ text, by: baseline, at: change.at }] : [] };
  return trackedText(record) === text ? record : apply(record, text, change);
}

/** Replace or add one chapter's record in the file, chapters kept in order. */
export function withChapter(file: ProvenanceFile, record: ChapterProvenance): ProvenanceFile {
  const chapters = [...file.chapters.filter((entry) => entry.chapter !== record.chapter), record].sort((a, b) => a.chapter - b.chapter);
  return { version: 1, chapters };
}

export interface AuthoredSpan {
  readonly start: number;
  readonly end: number;
  readonly by: AuthorId;
  readonly at: string;
  readonly via?: string;
}

/** The record as offsets into its text, for drawing provenance in the editor. */
export function spans(record: ChapterProvenance): AuthoredSpan[] {
  let at = 0;
  return record.segments.map((segment) => {
    const span = { start: at, end: at + segment.text.length, by: segment.by, at: segment.at, ...(segment.via ? { via: segment.via } : {}) };
    at = span.end;
    return span;
  });
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
/** Words for alphabetic text, characters for CJK, as InkOS counts length. */
const size = (text: string) => (text.match(CJK)?.length ?? 0) + (text.replace(CJK, " ").match(WORD)?.length ?? 0);

export interface Share {
  readonly words: number;
  /** Of the chapter's or book's words, 0 to 1. */
  readonly share: number;
}

export interface ChapterSummary {
  readonly chapter: number;
  readonly words: number;
  readonly byKind: Readonly<Record<AuthorKind, Share>>;
  readonly byAuthor: Readonly<Record<string, Share>>;
  /** False when the record no longer matches the chapter on disk (`stale` words are counted as unknown). */
  readonly current: boolean;
}

export interface ProvenanceSummary {
  readonly chapters: ChapterSummary[];
  readonly words: number;
  readonly byKind: Readonly<Record<AuthorKind, Share>>;
  readonly byAuthor: Readonly<Record<string, Share>>;
}

const KINDS: ReadonlyArray<AuthorKind> = ["human", "agent", "import", "unknown"];

function shares(counts: ReadonlyMap<string, number>, total: number): Record<string, Share> {
  return Object.fromEntries([...counts].sort(([, a], [, b]) => b - a).map(([key, words]) => [key, { words, share: total ? words / total : 0 }]));
}

/**
 * Who wrote how much of each chapter, in words. `texts` are the chapters as they are
 * on disk: a chapter whose record is missing or out of date is reconciled in memory
 * first, with the untracked difference counted as unknown.
 */
export function summarize(file: ProvenanceFile, texts: ReadonlyMap<number, string>): ProvenanceSummary {
  const records = new Map(file.chapters.map((record) => [record.chapter, record]));
  const bookKinds = new Map<string, number>(KINDS.map((kind) => [kind, 0]));
  const bookAuthors = new Map<string, number>();
  const chapters: ChapterSummary[] = [];
  let bookWords = 0;
  for (const [chapter, text] of [...texts].sort(([a], [b]) => a - b)) {
    const stored = records.get(chapter);
    const current = stored !== undefined && trackedText(stored) === text;
    const record = reconcile(stored, chapter, text, { by: "unknown", at: "", via: "untracked" });
    const kinds = new Map<string, number>(KINDS.map((kind) => [kind, 0]));
    const authors = new Map<string, number>();
    let words = 0;
    for (const segment of record.segments) {
      const n = size(segment.text);
      if (!n) continue;
      words += n;
      kinds.set(kindOf(segment.by), (kinds.get(kindOf(segment.by)) ?? 0) + n);
      authors.set(segment.by, (authors.get(segment.by) ?? 0) + n);
      bookAuthors.set(segment.by, (bookAuthors.get(segment.by) ?? 0) + n);
      bookKinds.set(kindOf(segment.by), (bookKinds.get(kindOf(segment.by)) ?? 0) + n);
    }
    bookWords += words;
    chapters.push({ chapter, words, byKind: shares(kinds, words) as Record<AuthorKind, Share>, byAuthor: shares(authors, words), current });
  }
  return { chapters, words: bookWords, byKind: shares(bookKinds, bookWords) as Record<AuthorKind, Share>, byAuthor: shares(bookAuthors, bookWords) };
}

const pct = (share: number) => `${Math.round(share * 1000) / 10}%`;

/** A provenance report a writer can attach to a submission: shares by kind and author, per chapter. */
export function markdownReport(summary: ProvenanceSummary, title: string, generatedAt = new Date().toISOString()): string {
  const kindRow = (byKind: Readonly<Record<AuthorKind, Share>>) => KINDS.map((kind) => pct(byKind[kind]?.share ?? 0)).join(" | ");
  const lines = [
    `# Provenance report: ${title}`,
    "",
    `Generated ${generatedAt.slice(0, 10)} by plotlint. Each passage is attributed to whoever last wrote it: a person, an AI agent and its model, imported text, or unknown when it changed outside plotlint's recorders.`,
    "",
    `**Whole book (${summary.words.toLocaleString("en")} words):** ${KINDS.map((kind) => `${kind} ${pct(summary.byKind[kind]?.share ?? 0)}`).join(", ")}.`,
    "",
    "## By author",
    "",
    "| Author | Words | Share |",
    "| --- | --- | --- |",
    ...Object.entries(summary.byAuthor).map(([author, share]) => `| ${author} | ${share.words.toLocaleString("en")} | ${pct(share.share)} |`),
    "",
    "## By chapter",
    "",
    "| Chapter | Words | Human | Agent | Import | Unknown |",
    "| --- | --- | --- | --- | --- | --- |",
    ...summary.chapters.map((chapter) => `| ${chapter.chapter}${chapter.current ? "" : "*"} | ${chapter.words.toLocaleString("en")} | ${kindRow(chapter.byKind)} |`),
  ];
  if (summary.chapters.some((chapter) => !chapter.current)) lines.push("", "\\* changed since it was last recorded; the difference is counted as unknown.");
  return `${lines.join("\n")}\n`;
}
