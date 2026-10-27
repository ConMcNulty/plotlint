import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";

/**
 * Text model.
 *
 * InkOS chapters are plain text (often markdown-ish, with a blank line between
 * paragraphs). The editor holds them as one ProseMirror paragraph per LINE: the
 * text is split on "\n", every line becomes a paragraph (an empty line becomes an
 * empty paragraph), and `docToText` joins the paragraphs back with "\n". Nothing
 * is trimmed, collapsed or parsed, so `docToText(textToDoc(text)) === text` for
 * any string, including CJK, tabs, "\r" (kept inside the line) and runs of blank
 * lines. Plain-text offsets (what diagnostic ranges use) therefore count one
 * character per UTF-16 code unit inside a paragraph plus one for each line break.
 *
 * Splitting per blank-line-separated block instead would need hard breaks for
 * single newlines and would lose the exact count of blank lines, so it does not
 * round-trip. Markdown syntax (`# Heading`, `*emphasis*`) stays literal text.
 */

/** A plain-text character range, end exclusive, in the coordinates diagnostics use. */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

/** Build Tiptap JSON content for chapter text: one paragraph per line. */
export function textToDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => line
      ? { type: "paragraph", content: [{ type: "text", text: line }] }
      : { type: "paragraph" }),
  };
}

/** Build a ProseMirror document directly, skipping JSON (faster for large chapters). */
export function textToNode(schema: Schema, text: string, paragraph = "paragraph"): ProseMirrorNode {
  const type = schema.nodes[paragraph];
  if (!type) throw new Error(`schema has no ${paragraph} node`);
  return schema.topNodeType.create(null, text.split("\n").map((line) => type.create(null, line ? schema.text(line) : null)));
}

/** Chapter text for a document: each top-level block's text, joined with "\n". */
export function docToText(doc: ProseMirrorNode | JSONContent): string {
  if (isNode(doc)) {
    const lines: string[] = [];
    doc.forEach((block) => { lines.push(block.textContent); });
    return lines.join("\n");
  }
  return (doc.content ?? []).map(jsonText).join("\n");
}

function jsonText(node: JSONContent): string {
  return (node.text ?? "") + (node.content ?? []).map(jsonText).join("");
}

function isNode(doc: ProseMirrorNode | JSONContent): doc is ProseMirrorNode {
  return typeof (doc as ProseMirrorNode).nodeSize === "number";
}

/** One top-level block in an {@link OffsetMap}. */
export interface TextBlock {
  readonly index: number;
  /** ProseMirror position of the block's content start (just inside the block). */
  readonly pos: number;
  /** Plain-text offset of the block's first character. */
  readonly start: number;
  /** Length of the block's text. */
  readonly length: number;
  /** The block node, for blocks whose inline content is not only text. */
  readonly node: ProseMirrorNode;
}

/**
 * Converts between plain-text offsets and ProseMirror positions for one document
 * version. Building it is O(blocks); each lookup is O(log blocks). Inline leaf
 * nodes (a hard break, an image) count as zero characters, matching `docToText`.
 */
export class OffsetMap {
  readonly blocks: ReadonlyArray<TextBlock>;
  readonly textLength: number;

  private constructor(blocks: TextBlock[], textLength: number) {
    this.blocks = blocks;
    this.textLength = textLength;
  }

  static fromDoc(doc: ProseMirrorNode): OffsetMap {
    const blocks: TextBlock[] = [];
    let start = 0;
    doc.forEach((node, offset, index) => {
      if (index > 0) start += 1;
      const length = node.textContent.length;
      blocks.push({ index, pos: offset + 1, start, length, node });
      start += length;
    });
    return new OffsetMap(blocks, start);
  }

  /** The block containing `offset` (the line break after a block belongs to it). */
  blockAtOffset(offset: number): TextBlock {
    const blocks = this.blocks;
    let low = 0;
    let high = blocks.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (blocks[mid]!.start <= offset) low = mid;
      else high = mid - 1;
    }
    return blocks[low]!;
  }

  /** The block containing position `pos`; positions between blocks belong to the next one. */
  blockAtPos(pos: number): TextBlock {
    const blocks = this.blocks;
    let low = 0;
    let high = blocks.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (blocks[mid]!.pos - 1 <= pos) low = mid;
      else high = mid - 1;
    }
    return blocks[low]!;
  }

  /** ProseMirror position for a plain-text offset (clamped to the document). */
  toPos(offset: number): number {
    const clamped = Math.max(0, Math.min(offset, this.textLength));
    const block = this.blockAtOffset(clamped);
    const within = Math.min(clamped - block.start, block.length);
    if (block.node.content.size === block.length) return block.pos + within;
    return block.pos + inlinePos(block.node, within);
  }

  /** Plain-text offset for a ProseMirror position. */
  toOffset(pos: number): number {
    const block = this.blockAtPos(pos);
    if (pos < block.pos) return block.start;
    const within = pos - block.pos;
    if (block.node.content.size === block.length) return block.start + Math.min(within, block.length);
    return block.start + inlineOffset(block.node, within);
  }

  /** Expand a text range to whole paragraphs: from the first block's start to the last block's end. */
  paragraphRange(range: TextRange): TextRange & { readonly firstBlock: number; readonly lastBlock: number } {
    const first = this.blockAtOffset(range.start);
    const last = this.blockAtOffset(Math.max(range.start, range.end));
    return { start: first.start, end: last.start + last.length, firstBlock: first.index, lastBlock: last.index };
  }
}

/** Content-relative position of character `chars` in a block with inline leaves. */
function inlinePos(block: ProseMirrorNode, chars: number): number {
  let remaining = chars;
  let result = block.content.size;
  let found = false;
  block.forEach((child, offset) => {
    if (found) return;
    if (child.isText) {
      const length = child.text!.length;
      if (remaining <= length) {
        result = offset + remaining;
        found = true;
        return;
      }
      remaining -= length;
    } else if (remaining === 0) {
      result = offset;
      found = true;
    }
  });
  return result;
}

/** Characters before content-relative position `within` in a block with inline leaves. */
function inlineOffset(block: ProseMirrorNode, within: number): number {
  let chars = 0;
  block.forEach((child, offset) => {
    if (offset >= within) return;
    if (child.isText) chars += Math.min(child.text!.length, within - offset);
  });
  return chars;
}
