import type { Node } from "prosemirror-model";
import type { MarkdownSource, Range } from "./source.ts";

/** Where each position of a textblock's content came from: `start[k]` and `end[k]` span position `k`, -1 when unknown. */
interface Spans {
  start: readonly number[];
  end: readonly number[];
  contentStart: number;
  contentEnd: number;
}

/**
 * The offset in `source.text` that document position `pos` of `source.doc` was read from. A
 * position in text maps to the start of the character after it, or the end of the one before it
 * at the end of a block; a position between blocks maps to the start of the block after it.
 */
export function sourceOffsetAt(source: MarkdownSource, pos: number): number {
  const $pos = source.doc.resolve(pos);
  const parent = $pos.parent;
  const range = source.ranges.get(parent);
  if (parent.isTextblock && range && range.start >= 0) {
    return offsetInTextblock(spansOf(source, parent, range), $pos.parentOffset) ?? range.start;
  }
  const after = $pos.nodeAfter && source.ranges.get($pos.nodeAfter);
  if (after && after.start >= 0) return after.start;
  const before = $pos.nodeBefore && source.ranges.get($pos.nodeBefore);
  if (before && before.end >= 0) return before.end;
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const r = source.ranges.get($pos.node(depth));
    if (r && r.start >= 0) return r.start;
  }
  return 0;
}

/**
 * The document position of `source.doc` that source offset `offset` was read into: a position in
 * the textblock holding the offset, or the start of the next textblock when the offset falls in
 * syntax between blocks. An offset in a block with no text gives the position before that block.
 */
export function positionAt(source: MarkdownSource, offset: number): number {
  const blocks: { node: Node; pos: number; range: Range }[] = [];
  source.doc.descendants((node, pos) => {
    if (!node.isTextblock && !(node.isBlock && node.isAtom)) return true;
    const range = source.ranges.get(node);
    if (range && range.start >= 0) blocks.push({ node, pos, range });
    return false;
  });
  let last = 0;
  for (const { node, pos, range } of blocks) {
    if (!node.isTextblock) {
      if (offset < range.end) return pos;
      continue;
    }
    if (offset <= range.end) return pos + 1 + positionInTextblock(spansOf(source, node, range), offset, node);
    last = pos + 1 + node.content.size;
  }
  return last;
}

function spansOf(source: MarkdownSource, node: Node, range: Range): Spans {
  return source.chars.get(node) ?? codeSpans(source.text, node, range);
}

/**
 * The spans of a code block's text: each line of its text is the end of a source line, after the
 * opening fence when there is one, with any indentation or container markers before it.
 */
function codeSpans(text: string, node: Node, range: Range): Spans {
  let p = range.start;
  if (/^[ \t]*(?:`{3}|~{3})/.test(text.slice(range.start, range.end))) {
    const newline = text.indexOf("\n", range.start);
    p = newline < 0 || newline >= range.end ? range.end : newline + 1;
  }
  const start: number[] = [];
  const end: number[] = [];
  const contentStart = p;
  const lines = node.textContent.split("\n");
  lines.forEach((line, j) => {
    let eol = p;
    while (eol < text.length && text[eol] !== "\n" && text[eol] !== "\r") eol++;
    const first = p + Math.max(0, eol - p - line.length);
    for (let c = 0; c < line.length; c++) {
      start.push(first + c);
      end.push(first + c + 1);
    }
    if (j === lines.length - 1) return;
    const next = text.startsWith("\r\n", eol) ? eol + 2 : eol + 1;
    start.push(eol);
    end.push(next);
    p = next;
  });
  const clamp = (x: number) => Math.min(x, range.end);
  return { start: start.map(clamp), end: end.map(clamp), contentStart, contentEnd: clamp(end.at(-1) ?? p) };
}

/** The source offset of position `k` in a textblock; null when nothing near it is known. */
function offsetInTextblock(spans: Spans, k: number): number | null {
  const { start, end } = spans;
  if (k < start.length && start[k]! >= 0) return start[k]!;
  if (k > 0 && end[k - 1]! >= 0) return end[k - 1]!;
  for (let i = k + 1; i < start.length; i++) if (start[i]! >= 0) return start[i]!;
  for (let i = Math.min(k, start.length) - 1; i >= 0; i--) if (end[i]! >= 0) return end[i]!;
  if (k === 0 && spans.contentStart >= 0) return spans.contentStart;
  return spans.contentEnd >= 0 ? spans.contentEnd : null;
}

/** The position in a textblock's content of the first character that ends after `offset`; its end when none does. */
function positionInTextblock(spans: Spans, offset: number, node: Node): number {
  const { start, end } = spans;
  for (let k = 0; k < start.length; k++) {
    if (start[k]! < 0) continue;
    if (end[k]! > offset) return k;
  }
  return node.content.size;
}
