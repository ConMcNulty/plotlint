import { describe, expect, it } from "vitest";
import {
  dialogueRatio, dialogueSpans, measureChapter, mtld, proseParagraphs, sensoryDensity, senseOf, sentenceRhythm, sentences, wallOfText,
} from "../index.js";

describe("mtld", () => {
  it("counts a factor each time the type-token ratio reaches 0.72", () => {
    // a b a -> TTR 2/3 = 0.667: one factor every three tokens, both ways.
    expect(mtld("a b a b a b".split(" "))).toBe(3);
    expect(mtld(["a", "a"])).toBe(2);
  });

  it("adds a partial factor for the remainder", () => {
    // TTR ends at 3/4: partial factor (1 - 0.75) / (1 - 0.72); same backwards.
    expect(mtld(["a", "b", "c", "a"])).toBeCloseTo(4 / (0.25 / 0.28), 6);
  });

  it("averages the forward and backward passes", () => {
    // Forward: a b c c -> 3/4 = 0.75, partial; backward: c c -> 0.5, a factor, then b a partial 0.
    const forward = 4 / (0.25 / 0.28);
    const backward = 4 / 1;
    expect(mtld(["a", "b", "c", "c"])).toBeCloseTo((forward + backward) / 2, 6);
  });

  it("gives a text that never repeats its length, and nothing for no tokens", () => {
    expect(mtld(["one", "two", "three"])).toBe(3);
    expect(mtld([])).toBeNull();
  });

  it("hardly depends on length for the same kind of text", () => {
    const vocabulary = Array.from({ length: 40 }, (_, i) => `w${i}`);
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sample = (n: number) => Array.from({ length: n }, () => vocabulary[Math.floor(random() * vocabulary.length)]!);
    const short = mtld(sample(500))!;
    const long = mtld(sample(5000))!;
    expect(Math.abs(short - long) / long).toBeLessThan(0.2);
  });
});

describe("dialogue", () => {
  it("handles straight and curly double quotes", () => {
    const text = `"Come here," she said. He stayed.\n\n“Why?” he asked. “I am busy.”`;
    const spans = dialogueSpans(text).map((span) => text.slice(span.start, span.end));
    expect(spans).toEqual([`"Come here,"`, "“Why?”", "“I am busy.”"]);
    const ratio = dialogueRatio(text);
    expect(ratio.dialogueWords).toBe(6);
    expect(ratio.words).toBe(12);
  });

  it("runs an unclosed quote to the end of its paragraph, for speech that goes on", () => {
    const text = "“It began long ago, in the north.\n\n“And it ended here,” he said.";
    expect(dialogueSpans(text).map((span) => text.slice(span.start, span.end))).toEqual([
      "“It began long ago, in the north.", "“And it ended here,”",
    ]);
  });

  it("reads single curly quotes as speech only when the text has no double quotes", () => {
    const british = "‘Come in,’ said the girls’ aunt. It was cold.";
    expect(dialogueSpans(british).map((span) => british.slice(span.start, span.end))).toEqual(["‘Come in,’"]);
    const american = "“Don’t,” she said. The dog’s ‘friend’ barked.";
    expect(dialogueSpans(american).map((span) => american.slice(span.start, span.end))).toEqual(["“Don’t,”"]);
  });
});

describe("sentences and rhythm", () => {
  it("does not end a sentence at titles or initials, and ends one after a closing quote", () => {
    const text = `Mr. Holmes met J. Watson at noon. "Late again!" he cried. They left.`;
    expect(sentences(text).map((s) => text.slice(s.start, s.end))).toEqual([
      "Mr. Holmes met J. Watson at noon.", `"Late again!" he cried.`, "They left.",
    ]);
  });

  it("computes mean, standard deviation and coefficient of variation", () => {
    const text = "One two. One two three four. One two three four five six.";
    const rhythm = sentenceRhythm(sentences(text))!;
    expect(rhythm.lengths).toEqual([2, 4, 6]);
    expect(rhythm.mean).toBe(4);
    expect(rhythm.stdev).toBeCloseTo(Math.sqrt(8 / 3), 9);
    expect(rhythm.cv).toBeCloseTo(Math.sqrt(8 / 3) / 4, 9);
  });

  it("finds a flat stretch of eight or more same-length sentences and merges overlapping windows", () => {
    const varied = "He ran. The long road wound down past the mill and over the old stone bridge to town. She waited. ";
    const flat = Array.from({ length: 10 }, (_, i) => `The man walked to the ${["door", "gate", "shed", "barn", "well"][i % 5]} again.`).join(" ");
    const text = `${varied}${flat} ${varied}`;
    const rhythm = sentenceRhythm(sentences(text))!;
    expect(rhythm.flat).toHaveLength(1);
    const stretch = rhythm.flat[0]!;
    expect(stretch.toSentence - stretch.fromSentence).toBe(10);
    expect(text.slice(stretch.start, stretch.end)).toBe(flat);
    expect(stretch.cv).toBe(0);
  });

  it("skips windows that are mostly dialogue", () => {
    const text = Array.from({ length: 10 }, () => `"Go home now," he said.`).join(" ");
    expect(sentenceRhythm(sentences(text))!.flat).toEqual([]);
  });
});

describe("sensory detail and walls of text", () => {
  it("matches base forms and plain inflections", () => {
    expect(senseOf("glinting")).toBe("sight");
    expect(senseOf("dimmed")).toBe("sight");
    expect(senseOf("smells")).toBe("smell");
    expect(senseOf("throbbing")).toBe("touch");
    expect(senseOf("idea")).toBeUndefined();
    const density = sensoryDensity("The bell rang. The air smelled of salt. She thought about it.");
    expect(density.count).toBe(3);
    expect(density.words).toBe(12);
    expect(density.perThousand).toBeCloseTo(250, 6);
  });

  it("finds the longest narration with no dialogue and no paragraph break", () => {
    const text = `Short one here.\n\nA b c d e "quoted words here" f g h i j k.\n\nTwo words.`;
    const wall = wallOfText(text)!;
    expect(wall.words).toBe(6);
    expect(text.slice(wall.start, wall.end)).toBe("f g h i j k");
  });
});

describe("measureChapter", () => {
  const chapter = [
    "# Chapter 1: The Pier",
    "",
    "The fog came in off the sea. Mira stood on the pier with the brass key in her fist.",
    "",
    "***",
    "",
    "“You’re late,” he said. “Blame the ferry.”",
  ].join("\n");

  it("skips headings and scene breaks", () => {
    const paragraphs = proseParagraphs(chapter);
    expect(paragraphs.map((p) => chapter.slice(p.start, p.end).slice(0, 8))).toEqual(["The fog ", "“You’re "]);
    expect(measureChapter(chapter)!.words).toBe(26);
  });

  it("gives the same metrics for CRLF text, with offsets into the CRLF text", () => {
    const crlf = chapter.replace(/\n/g, "\r\n");
    const lf = measureChapter(chapter)!;
    const metrics = measureChapter(crlf)!;
    expect(metrics.words).toBe(lf.words);
    expect(metrics.mtld).toBe(lf.mtld);
    expect(metrics.dialogue).toEqual(lf.dialogue);
    expect(metrics.rhythm!.lengths).toEqual(lf.rhythm!.lengths);
    expect(crlf.slice(metrics.wallOfText!.start, metrics.wallOfText!.end)).toBe(chapter.slice(lf.wallOfText!.start, lf.wallOfText!.end));
    for (const paragraph of metrics.paragraphs) expect(crlf.slice(paragraph.start, paragraph.end)).not.toMatch(/^\s|\s$/u);
  });

  it("returns null for CJK chapters", () => {
    expect(measureChapter("第一章\n\n雾从海上来。她站在码头上，手里握着铜钥匙。")).toBeNull();
  });
});
