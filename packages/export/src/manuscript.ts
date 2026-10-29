import { AlignmentType, Document, Header, LineRuleType, Packer, PageNumber, Paragraph, TextRun, convertInchesToTwip } from "docx";

// Standard manuscript format (PLAN, "Export"), as agents and editors ask for it:
// a title page with contact details and a rounded word count, then the text in a
// 12pt serif, double spaced, with 1" margins, first lines indented half an inch, a
// running header (surname / short title / page), each chapter on a new page a
// third of the way down, "#" for scene breaks and "END" at the close.
// After William Shunn, "Proper Manuscript Format" (https://www.shunn.net/format/).

export interface ManuscriptChapter {
  readonly number: number;
  readonly title?: string;
  /** Scenes, each a list of paragraphs. */
  readonly scenes: ReadonlyArray<ReadonlyArray<string>>;
}

export interface ManuscriptAuthor {
  /** Legal name, for the contact block. */
  readonly name: string;
  /** Byline, if different from the legal name. */
  readonly byline?: string;
  /** For the running header; default the last word of the byline. */
  readonly surname?: string;
  /** Contact lines: address, phone, email. */
  readonly contact?: ReadonlyArray<string>;
}

export interface ManuscriptOptions {
  readonly title: string;
  /** For the running header; default the title, cut to a few words. */
  readonly shortTitle?: string;
  readonly author: ManuscriptAuthor;
  readonly chapters: ReadonlyArray<ManuscriptChapter>;
  /** "Times New Roman" (default) or "Courier New". */
  readonly font?: string;
}

const SCENE_BREAK = /^\s*(?:#|\*\s*\*\s*\*|\*{3,}|-{3,}|_{3,}|~{3,}|◇+|＊+|※+)\s*$/u;
const HEADING = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

/** Words for alphabetic text, characters for CJK. */
export function countWords(text: string): number {
  return (text.match(CJK)?.length ?? 0) + (text.replace(CJK, " ").match(WORD)?.length ?? 0);
}

/** Words as a manuscript states them: to the nearest 100, or to the nearest 1,000 at novel length. */
export function roundedWordCount(words: number): number {
  if (words < 100) return words;
  const unit = words >= 17_500 ? 1_000 : 100;
  return Math.max(unit, Math.round(words / unit) * unit);
}

/** Strip inline Markdown emphasis and links, keeping the words. */
function plain(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/(\*\*|__)(.+?)\1/gu, "$2")
    .replace(/(?<![\p{L}\p{N}])([*_])(.+?)\1(?![\p{L}\p{N}])/gu, "$2")
    .replace(/`([^`]+)`/gu, "$1")
    .trim();
}

/**
 * A chapter file as InkOS saves it (`# Chapter 3: Title`, blank-line paragraphs,
 * `---`, `***` or `#` between scenes) as manuscript paragraphs. Single line breaks
 * inside a paragraph are joined.
 */
export function parseChapter(number: number, markdown: string): ManuscriptChapter {
  let title: string | undefined;
  const scenes: string[][] = [[]];
  for (const block of markdown.replace(/\r\n?/gu, "\n").split(/\n\s*\n/u)) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    const heading = lines[0]!.match(HEADING);
    if (heading && lines.length === 1 && title === undefined && scenes.length === 1 && scenes[0]!.length === 0) {
      title = plain(heading[1]!);
      continue;
    }
    if (lines.length === 1 && SCENE_BREAK.test(lines[0]!)) {
      if (scenes[scenes.length - 1]!.length) scenes.push([]);
      continue;
    }
    const text = plain(lines.join(" "));
    if (text) scenes[scenes.length - 1]!.push(text);
  }
  return { number, ...(title ? { title } : {}), scenes: scenes.filter((scene) => scene.length) };
}

export function manuscriptWords(chapters: ReadonlyArray<ManuscriptChapter>): number {
  return chapters.reduce((sum, chapter) => sum + chapter.scenes.flat().reduce((n, paragraph) => n + countWords(paragraph), 0), 0);
}

const shorten = (title: string) => {
  const words = title.split(/\s+/u);
  return words.length <= 4 ? title : words.slice(0, 4).join(" ");
};

/** The manuscript as a .docx file. */
export async function manuscriptDocx(options: ManuscriptOptions): Promise<Buffer> {
  const font = options.font ?? "Times New Roman";
  const cjk = (options.title + options.chapters.flatMap((chapter) => chapter.scenes.flat().slice(0, 3)).join("")).match(CJK)?.length ?? 0;
  const run = (text: string, extra: { bold?: boolean; allCaps?: boolean } = {}) => new TextRun({ text, font: cjk > 50 ? { ascii: font, eastAsia: "SimSun" } : font, size: 24, ...extra });
  const double = { line: 480, lineRule: LineRuleType.AUTO, before: 0, after: 0 };
  const single = { line: 240, lineRule: LineRuleType.AUTO, before: 0, after: 0 };
  const byline = options.author.byline ?? options.author.name;
  const surname = options.author.surname ?? byline.trim().split(/\s+/u).pop()!;
  const short = (options.shortTitle ?? shorten(options.title)).toUpperCase();
  const words = manuscriptWords(options.chapters);
  const unit = cjk > 50 ? "characters" : "words";

  const blank = (n: number) => Array.from({ length: n }, () => new Paragraph({ spacing: double, children: [run("")] }));
  const titlePage: Paragraph[] = [
    ...[options.author.name, ...(options.author.contact ?? [])].map((line, i) => new Paragraph({
      spacing: single,
      children: [run(line), ...(i === 0 ? [new TextRun({ text: "\t", size: 24 }), run(`about ${roundedWordCount(words).toLocaleString("en")} ${unit}`)] : [])],
      tabStops: [{ type: "right", position: convertInchesToTwip(6.5) }],
    })),
    ...blank(Math.max(1, 10 - (options.author.contact?.length ?? 0))),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: double, children: [run(options.title)] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: double, children: [run(`by ${byline}`)] }),
  ];

  const body: Paragraph[] = [];
  for (const chapter of options.chapters) {
    body.push(new Paragraph({ pageBreakBefore: true, spacing: double, children: [run("")] }));
    body.push(...blank(6));
    body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: double, children: [run(chapter.title ?? `Chapter ${chapter.number}`)] }));
    body.push(...blank(1));
    chapter.scenes.forEach((scene, i) => {
      if (i > 0) body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: double, children: [run("#")] }));
      for (const paragraph of scene) body.push(new Paragraph({ spacing: double, indent: { firstLine: convertInchesToTwip(0.5) }, children: [run(paragraph)] }));
    });
  }
  body.push(...blank(1), new Paragraph({ alignment: AlignmentType.CENTER, spacing: double, children: [run("END")] }));

  const margin = convertInchesToTwip(1);
  const document = new Document({
    creator: byline,
    title: options.title,
    sections: [{
      properties: { titlePage: true, page: { margin: { top: margin, bottom: margin, left: margin, right: margin, header: convertInchesToTwip(0.5) } } },
      headers: {
        first: new Header({ children: [new Paragraph({ children: [] })] }),
        default: new Header({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(`${surname} / ${short} / `), new TextRun({ children: [PageNumber.CURRENT], font, size: 24 })] })],
        }),
      },
      children: [...titlePage, ...body],
    }],
  });
  return Packer.toBuffer(document);
}
