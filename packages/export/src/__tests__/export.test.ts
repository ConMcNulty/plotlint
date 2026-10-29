import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  draftMarkdown, manuscriptDocx, manuscriptWords, outline, parseChapter, roundedWordCount, submissionPackage, unknownNames,
  type Message, type SubmissionBook,
} from "../index.js";

const CHAPTER = "# Chapter 1: The Gate\n\nNell reached the *gate* at dusk.\nThe water was still.\n\n---\n\nIn the morning the box was gone. [See](http://x) it.\n";

describe("manuscript", () => {
  it("parses a chapter into a title and scenes, joining lines and dropping Markdown", () => {
    expect(parseChapter(1, CHAPTER)).toEqual({
      number: 1,
      title: "Chapter 1: The Gate",
      scenes: [["Nell reached the gate at dusk. The water was still."], ["In the morning the box was gone. See it."]],
    });
    expect(parseChapter(2, "第二章\n\n她走了。").title).toBeUndefined();
    expect(parseChapter(3, "# 第三章 归来\n\n她回来了。\n\n※\n\n天亮了。").scenes).toHaveLength(2);
  });

  it("rounds word counts as manuscripts state them", () => {
    expect(roundedWordCount(42)).toBe(42);
    expect(roundedWordCount(4_349)).toBe(4_300);
    expect(roundedWordCount(82_640)).toBe(83_000);
  });

  it("writes a .docx with a title page, running header, scene breaks and END", async () => {
    const chapters = [parseChapter(1, CHAPTER), parseChapter(2, "# Chapter 2\n\nShe waited.")];
    expect(manuscriptWords(chapters)).toBe(21);
    const buffer = await manuscriptDocx({ title: "The Lessing Fen Mystery", author: { name: "Cob Example", byline: "C. Fen", contact: ["cob@example.com"] }, chapters });
    const zip = await JSZip.loadAsync(buffer);
    const body = await zip.file("word/document.xml")!.async("string");
    const text = [...body.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/gu)].map((m) => m[1]).join("|");
    expect(text).toContain("Cob Example|\t|about 21 words");
    expect(text).toContain("The Lessing Fen Mystery|by C. Fen");
    expect(text).toContain("Chapter 1: The Gate");
    expect(text).toMatch(/still\.\|#\|In the morning/u);
    expect(text).toMatch(/END$/u);
    const headers = await Promise.all(Object.keys(zip.files).filter((name) => /^word\/header\d+\.xml$/u.test(name)).map((name) => zip.file(name)!.async("string")));
    expect(headers.join("")).toContain("Fen / THE LESSING FEN MYSTERY / ");
    expect(body).toContain('w:line="480"');
    expect(body).toContain("<w:titlePg/>");
  });
});

const BOOK: SubmissionBook = {
  title: "Still Water",
  genre: "mystery",
  language: "en",
  words: 82_000,
  names: ["Nell Lessing", "Pell"],
  summaries: [
    { chapter: 2, title: "The Box", characters: "Nell, Pell", events: "Nell finds the box gone.", stateChanges: "", hookActivity: "box: advanced", mood: "tense", chapterType: "investigation" },
    { chapter: 1, title: "The Gate", characters: "Nell", events: "Nell reaches the mill gate.", stateChanges: "", hookActivity: "none", mood: "calm", chapterType: "setup" },
  ],
};

describe("submission package", () => {
  it("builds the outline from the summaries in chapter order", () => {
    const text = outline(BOOK);
    expect(text.indexOf("Chapter 1: The Gate")).toBeLessThan(text.indexOf("Chapter 2: The Box"));
    expect(text).toContain("Threads: box: advanced");
    expect(text).not.toContain("Threads: none");
  });

  it("lists names a draft uses that the book never does", () => {
    expect(unknownNames("Nell meets Inspector Grady at the mill, and Pell lies.", BOOK)).toEqual(["Grady", "Inspector"]);
  });

  it("drafts the synopsis and query from the summaries and marks them as drafts", async () => {
    const sent: Message[][] = [];
    const complete = async (messages: ReadonlyArray<Message>) => {
      sent.push([...messages]);
      return messages[0]!.content.includes("synopsis") ? "Nell Lessing returns to the fen. In the end Pell confesses." : "Dear [Agent name],\n\nStill Water is a complete 82,000-word mystery novel.";
    };
    const pack = await submissionPackage(BOOK, complete);
    expect(sent).toHaveLength(2);
    expect(sent[0]![1]!.content).toContain('Chapter 1 "The Gate"');
    expect(pack.synopsis.unknownNames).toEqual([]);
    expect(draftMarkdown("Synopsis", pack.synopsis, "en")).toContain("Draft: written by a model");
    await expect(submissionPackage({ ...BOOK, summaries: [] }, complete)).rejects.toThrow("no chapter summaries");
  });
});
