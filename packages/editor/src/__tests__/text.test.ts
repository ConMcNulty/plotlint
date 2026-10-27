import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { docToText, OffsetMap, PlainTextDocument, textToDoc, textToNode } from "../index.js";
import { createEditor } from "./helpers.js";

const schema = getSchema(PlainTextDocument);

const samples: Record<string, string> = {
  empty: "",
  "single newline": "\n",
  "blank lines": "\n\n\n",
  "inkos chapter": "# 第一章 风起\n\n林远推开门，雨还在下。\n\n“你来了。”她说。\n",
  "mixed scripts": "Alice met 林远 at the café.\n\n\n\nThey spoke for an hour — 一个小时。",
  "leading and trailing space": "  indented\t tab\n\n trailing  ",
  "crlf kept in lines": "line one\r\n\r\nline two\r\n",
  "surrogate pairs": "emoji 😀 and 𠀋 rare han\n\n",
};

describe("text model", () => {
  for (const [name, text] of Object.entries(samples)) {
    it(`round-trips ${name} through JSON, nodes and the editor`, () => {
      expect(docToText(textToDoc(text))).toBe(text);
      expect(docToText(textToNode(schema, text))).toBe(text);
      expect(docToText(schema.nodeFromJSON(textToDoc(text)))).toBe(text);
      const editor = createEditor(text);
      expect(docToText(editor.state.doc)).toBe(text);
      editor.destroy();
    });
  }

  it("makes one paragraph per line, empty lines included", () => {
    const doc = textToNode(schema, "a\n\nb");
    expect(doc.childCount).toBe(3);
    expect(doc.child(1).content.size).toBe(0);
  });
});

describe("OffsetMap", () => {
  for (const [name, text] of Object.entries(samples)) {
    it(`maps every offset in ${name} to the same text`, () => {
      const doc = textToNode(schema, text);
      const map = OffsetMap.fromDoc(doc);
      expect(map.textLength).toBe(text.length);
      for (let offset = 0; offset <= text.length; offset++) {
        expect(map.toOffset(map.toPos(offset))).toBe(offset);
      }
      for (let start = 0; start <= text.length; start++) {
        for (let end = start; end <= Math.min(text.length, start + 12); end++) {
          expect(doc.textBetween(map.toPos(start), map.toPos(end), "\n")).toBe(text.slice(start, end));
        }
      }
    });
  }

  it("places offsets in the right paragraph", () => {
    const text = "ab\n\ncd";
    const map = OffsetMap.fromDoc(textToNode(schema, text));
    // doc: <p>ab</p><p></p><p>cd</p>; content starts at 1, 5, 7.
    expect(map.blocks.map((block) => [block.pos, block.start, block.length])).toEqual([[1, 0, 2], [5, 3, 0], [7, 4, 2]]);
    expect(map.toPos(0)).toBe(1);
    expect(map.toPos(2)).toBe(3);
    expect(map.toPos(3)).toBe(5);
    expect(map.toPos(4)).toBe(7);
    expect(map.toPos(6)).toBe(9);
    expect(map.toPos(99)).toBe(9);
    expect(map.toOffset(4)).toBe(3); // between paragraphs belongs to the next one
  });

  it("expands ranges to whole paragraphs", () => {
    const text = "first line\nsecond line\nthird";
    const map = OffsetMap.fromDoc(textToNode(schema, text));
    expect(map.paragraphRange({ start: 13, end: 14 })).toEqual({ start: 11, end: 22, firstBlock: 1, lastBlock: 1 });
    expect(map.paragraphRange({ start: 2, end: 25 })).toEqual({ start: 0, end: 28, firstBlock: 0, lastBlock: 2 });
  });
});
