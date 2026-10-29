// The submission package (PLAN, "Export"): an outline, a synopsis and a query letter,
// drafted from the book's state rather than from memory. The outline is built from
// InkOS's chapter summaries by code. The synopsis and query are LLM drafts from the
// same summaries, marked as drafts, with any name the book never uses listed so the
// writer can check it. Personal details (bio, comparable titles) are left as
// placeholders: the model must not invent them.

/** A chapter summary row as InkOS keeps it (`story/state/chapter_summaries.json`). */
export interface SummaryRow {
  readonly chapter: number;
  readonly title: string;
  readonly characters: string;
  readonly events: string;
  readonly stateChanges: string;
  readonly hookActivity: string;
  readonly mood: string;
  readonly chapterType: string;
}

export interface Message {
  readonly role: "system" | "user";
  readonly content: string;
}

export type Complete = (messages: ReadonlyArray<Message>) => Promise<string>;

export interface SubmissionBook {
  readonly title: string;
  readonly genre?: string;
  readonly language: "en" | "zh";
  readonly words: number;
  readonly summaries: ReadonlyArray<SummaryRow>;
  /** Proper names the book uses (characters, places), from its state, to check drafts against. */
  readonly names?: ReadonlyArray<string>;
}

export interface Draft {
  readonly text: string;
  /** Capitalised names in the draft that appear nowhere in the summaries or the book's names. */
  readonly unknownNames: string[];
}

export interface SubmissionPackage {
  readonly outline: string;
  readonly synopsis: Draft;
  readonly query: Draft;
}

const clean = (text: string) => text.replace(/\s+/gu, " ").trim();

/** Chapter by chapter, from the summaries: what happens and which threads move. */
export function outline(book: SubmissionBook): string {
  const rows = [...book.summaries].sort((a, b) => a.chapter - b.chapter);
  const zh = book.language === "zh";
  const lines = [`# ${book.title}: ${zh ? "章节大纲" : "chapter outline"}`, ""];
  for (const row of rows) {
    lines.push(`## ${zh ? `第${row.chapter}章` : `Chapter ${row.chapter}`}: ${clean(row.title)}`, "");
    if (clean(row.events)) lines.push(clean(row.events), "");
    const threads = clean(row.hookActivity);
    if (threads && !/^(?:none|无|-)$/iu.test(threads)) lines.push(`${zh ? "线索" : "Threads"}: ${threads}`, "");
  }
  if (!rows.length) lines.push(zh ? "（还没有章节摘要：先结算章节。）" : "(No chapter summaries yet: settle the chapters first.)", "");
  return `${lines.join("\n").trimEnd()}\n`;
}

function digest(book: SubmissionBook): string {
  return [...book.summaries].sort((a, b) => a.chapter - b.chapter).map((row) =>
    `Chapter ${row.chapter} "${clean(row.title)}" [${clean(row.chapterType)}; mood ${clean(row.mood)}]\n`
    + `  characters: ${clean(row.characters)}\n  events: ${clean(row.events)}\n  changes: ${clean(row.stateChanges)}\n  threads: ${clean(row.hookActivity)}`).join("\n");
}

const STOP = new Set([
  "The", "A", "An", "And", "But", "Or", "If", "When", "While", "As", "In", "On", "At", "Of", "To", "For", "With", "By", "From", "After", "Before",
  "He", "She", "They", "It", "His", "Her", "Their", "Its", "I", "We", "You", "This", "That", "These", "Those", "There", "Here", "Then", "Now",
  "Dear", "Thank", "Thanks", "Sincerely", "Best", "Regards", "Chapter", "Book", "Title", "Genre", "Synopsis", "Query", "Letter", "Agent", "Editor",
  "Meanwhile", "Finally", "Eventually", "Soon", "Later", "Yet", "Still", "So", "Not", "No", "All", "One", "Two", "Three", "What", "Who", "Why", "How",
  "Mr", "Mrs", "Ms", "Miss", "Dr", "Sir", "Lady", "Lord", "Captain", "End", "Part", "Act", "THE",
]);

/** Capitalised words in a draft that the book never uses: invented names the writer should check. */
export function unknownNames(draft: string, book: SubmissionBook): string[] {
  if (book.language === "zh") return [];
  const known = new Set<string>();
  const corpus = [book.title, book.genre ?? "", ...(book.names ?? []), ...book.summaries.flatMap((row) => [row.title, row.characters, row.events, row.stateChanges, row.hookActivity])].join(" ");
  for (const word of corpus.match(/\p{L}+/gu) ?? []) known.add(word.toLowerCase());
  const found = new Set<string>();
  // Skip words after a sentence end or at a line start: those are capitalised anyway.
  for (const match of draft.matchAll(/(?<![.!?:"“\n]\s*)(?<!^)\b(\p{Lu}\p{Ll}+)\b/gmu)) {
    const word = match[1]!;
    if (STOP.has(word) || known.has(word.toLowerCase())) continue;
    found.add(word);
  }
  return [...found].sort();
}

const SYNOPSIS_SYSTEM = {
  en: "You are an experienced literary agent's assistant writing a synopsis for a submission. Write in third person, present tense, in plain prose paragraphs, about 500 to 800 words. Cover the whole story, including the ending and how the central questions are answered: a synopsis is not a teaser. Name only characters who drive the plot, and only names that appear in the notes. Do not invent events, characters or places that the notes do not support. Reply with the synopsis only.",
  zh: "你是资深文学经纪人的助理，为投稿撰写故事梗概。用第三人称、现在时，写成连贯段落，约800到1500字。覆盖完整故事，包括结局和核心悬念如何解开：梗概不是预告。只写推动情节的角色，且只用笔记里出现的名字。不要编造笔记不支持的事件、人物或地点。只回复梗概正文。",
};

const QUERY_SYSTEM = {
  en: "You are an experienced literary agent's assistant drafting a query letter for the author. Write about 250 to 350 words: a one-line hook, then one or two paragraphs on the protagonist, what they want, what stands in the way and what is at stake (do not reveal the ending), then a closing paragraph. Use only names and events from the notes. Leave these as bracketed placeholders, never invent them: [Agent name], [comparable titles], [author bio], [personalisation]. Include the line: TITLE is a complete WORDS-word GENRE novel, using the facts given. Reply with the letter only.",
  zh: "你是资深文学经纪人的助理，为作者起草投稿信。约400到600字：一句话钩子，然后一两段介绍主角想要什么、阻碍是什么、代价是什么（不要透露结局），最后一段收尾。只用笔记里的名字和事件。以下内容用方括号占位，绝不编造：[编辑姓名]、[同类作品]、[作者简介]、[个性化说明]。写明：《书名》是一部已完成的、约若干字的某类型小说，使用给出的事实。只回复信件正文。",
};

function facts(book: SubmissionBook): string {
  const genre = book.genre?.trim() || (book.language === "zh" ? "（类型未定）" : "(genre not set)");
  return book.language === "zh"
    ? `书名：${book.title}\n类型：${genre}\n字数：约${book.words.toLocaleString("en")}字\n\n章节笔记：\n${digest(book)}`
    : `Title: ${book.title}\nGenre: ${genre}\nLength: about ${book.words.toLocaleString("en")} words\n\nChapter notes:\n${digest(book)}`;
}

const strip = (reply: string) => reply.replace(/^```(?:\w+)?\n?|\n?```$/gu, "").trim();

export async function synopsis(book: SubmissionBook, complete: Complete): Promise<Draft> {
  const text = strip(await complete([{ role: "system", content: SYNOPSIS_SYSTEM[book.language] }, { role: "user", content: facts(book) }]));
  return { text, unknownNames: unknownNames(text, book) };
}

export async function queryLetter(book: SubmissionBook, complete: Complete): Promise<Draft> {
  const text = strip(await complete([{ role: "system", content: QUERY_SYSTEM[book.language] }, { role: "user", content: facts(book) }]));
  return { text, unknownNames: unknownNames(text, book) };
}

/** The outline by code; the synopsis and the query letter as LLM drafts. Needs chapter summaries. */
export async function submissionPackage(book: SubmissionBook, complete: Complete): Promise<SubmissionPackage> {
  if (!book.summaries.length) throw new Error("the book has no chapter summaries yet; settle its chapters first");
  const [synopsisDraft, query] = [await synopsis(book, complete), await queryLetter(book, complete)];
  return { outline: outline(book), synopsis: synopsisDraft, query };
}

/** A draft as Markdown, headed as a draft, with names to check listed after it. */
export function draftMarkdown(heading: string, draft: Draft, language: "en" | "zh"): string {
  const zh = language === "zh";
  const lines = [`# ${heading}`, "", zh ? "> 草稿：由模型根据本书的章节摘要生成。投稿前请通读并改写。" : "> Draft: written by a model from the book's chapter summaries. Read and revise it before you send it.", "", draft.text, ""];
  if (draft.unknownNames.length) {
    lines.push("---", "", zh ? `书中找不到这些名字，请核对：${draft.unknownNames.join("、")}` : `These names do not appear in the book; check them: ${draft.unknownNames.join(", ")}`, "");
  }
  return lines.join("\n");
}
