import { byteOrderMark } from "../text/byte-order-mark.ts";
import type * as M from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import type { Attrs, Mark, Node } from "prosemirror-model";
import { mapText } from "./map-text.ts";
import { schema } from "./schema.ts";
import type { CharMap, MarkdownSource, Range } from "./source.ts";
import { detectStyle } from "./style.ts";

const frontmatterKinds = ["yaml", "toml"] as const;

/** Parses markdown (byte order mark already removed) to mdast with GFM, front matter and math. */
export function parseMdast(text: string): M.Root {
  return fromMarkdown(text, {
    extensions: [gfm(), frontmatter([...frontmatterKinds]), math()],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown([...frontmatterKinds]), mathFromMarkdown()],
  });
}

interface Piece {
  node: Node;
  start: number[];
  end: number[];
  run: number[];
}

const unknown: Range = { start: -1, end: -1 };

/** Parses a markdown file's text into a document that remembers where every node came from. */
export function parseMarkdown(input: string): MarkdownSource {
  const bom = input.startsWith(byteOrderMark);
  const text = bom ? input.slice(1) : input;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const ranges = new WeakMap<Node, Range>();
  const chars = new WeakMap<Node, CharMap>();
  const root = parseMdast(text);
  let runs = 0;

  const rangeOf = (n: M.Node): Range =>
    n.position ? { start: n.position.start.offset!, end: n.position.end.offset! } : { ...unknown };
  const sourceOf = (n: M.Node) => {
    const r = rangeOf(n);
    return r.start < 0 ? "" : text.slice(r.start, r.end);
  };
  const recorded = (pm: Node, n: M.Node) => {
    ranges.set(pm, rangeOf(n));
    return pm;
  };

  const atom = (node: Node, n: M.Node): Piece => {
    const r = rangeOf(n);
    return { node, start: [r.start], end: [r.end], run: [-1] };
  };

  const textPiece = (raw: string, marks: readonly Mark[], from: number, to: number): Piece | null => {
    const value = withoutCarriageReturns(raw);
    if (value === "") return null;
    const map = from >= 0 ? mapText(text, from, to, value) : null;
    const id = runs++;
    return {
      node: schema.text(value, marks),
      start: map ? map.start : new Array<number>(value.length).fill(-1),
      end: map ? map.end : new Array<number>(value.length).fill(-1),
      run: new Array<number>(value.length).fill(map ? id : -1),
    };
  };

  const inline = (nodes: readonly M.PhrasingContent[], marks: readonly Mark[], out: Piece[]): void => {
    for (const n of nodes) {
      const r = rangeOf(n);
      switch (n.type) {
        case "text": {
          const piece = textPiece(n.value, marks, r.start, r.end);
          if (piece) out.push(piece);
          break;
        }
        case "inlineCode": {
          const raw = sourceOf(n);
          const ticks = /^`*/.exec(raw)![0].length;
          let from = r.start < 0 ? -1 : r.start + ticks;
          let to = r.end - ticks;
          if (from >= 0 && text.slice(from, to) !== n.value && text[from] === " " && text[to - 1] === " ") {
            from++;
            to--;
          }
          const piece = textPiece(n.value, schema.marks.code.create().addToSet(marks), from, to);
          out.push(piece ?? atom(schema.nodes.raw_inline.create({ source: raw }, null, marks), n));
          break;
        }
        case "emphasis":
          inline(n.children, schema.marks.em.create().addToSet(marks), out);
          break;
        case "strong":
          inline(n.children, schema.marks.strong.create().addToSet(marks), out);
          break;
        case "delete":
          inline(n.children, schema.marks.strike.create().addToSet(marks), out);
          break;
        case "link":
          inline(n.children, schema.marks.link.create({ href: n.url, title: n.title ?? null }).addToSet(marks), out);
          break;
        case "linkReference": {
          const attrs = { identifier: n.identifier, label: n.label ?? null, referenceType: n.referenceType };
          inline(n.children, schema.marks.link.create(attrs).addToSet(marks), out);
          break;
        }
        case "break":
          out.push(atom(schema.nodes.hard_break.create(null, null, marks), n));
          break;
        case "image": {
          const attrs = { src: n.url, alt: n.alt ?? "", title: n.title ?? null };
          out.push(atom(schema.nodes.image.create(attrs, null, marks), n));
          break;
        }
        default:
          out.push(atom(schema.nodes.raw_inline.create({ source: sourceOf(n) }, null, marks), n));
      }
    }
  };

  const textblock = (type: string, attrs: Attrs | null, n: M.Parent): Node => {
    const pieces: Piece[] = [];
    inline(n.children as M.PhrasingContent[], [], pieces);
    const pm = schema.nodes[type]!.create(
      attrs,
      pieces.map((p) => p.node),
    );
    const first = n.children[0] ? rangeOf(n.children[0]) : unknown;
    const last = n.children.length > 0 ? rangeOf(n.children[n.children.length - 1]!) : unknown;
    chars.set(pm, {
      start: pieces.flatMap((p) => p.start),
      end: pieces.flatMap((p) => p.end),
      run: pieces.flatMap((p) => p.run),
      contentStart: first.start,
      contentEnd: last.end,
    });
    return recorded(pm, n);
  };

  const block = (n: M.Node): Node => {
    switch (n.type) {
      case "paragraph":
        return textblock("paragraph", null, n as M.Paragraph);
      case "heading":
        return textblock("heading", { level: (n as M.Heading).depth }, n as M.Heading);
      case "thematicBreak":
        return recorded(schema.nodes.thematic_break.create(), n);
      case "blockquote":
        return recorded(schema.nodes.blockquote.create(null, (n as M.Blockquote).children.map(block)), n);
      case "list": {
        const l = n as M.List;
        const attrs = { ordered: l.ordered ?? false, start: l.start ?? null, spread: l.spread ?? false };
        return recorded(schema.nodes.list.create(attrs, l.children.map(block)), n);
      }
      case "listItem": {
        const li = n as M.ListItem;
        const attrs = { checked: li.checked ?? null, spread: li.spread ?? false };
        return recorded(schema.nodes.list_item.create(attrs, li.children.map(block)), n);
      }
      case "code": {
        const c = n as M.Code;
        const attrs = { lang: c.lang ?? null, meta: c.meta ?? null };
        const value = withoutCarriageReturns(c.value);
        return recorded(schema.nodes.code_block.create(attrs, value ? schema.text(value) : null), n);
      }
      case "table": {
        const t = n as M.Table;
        return recorded(schema.nodes.table.create({ align: t.align ?? [] }, t.children.map(block)), n);
      }
      case "tableRow":
        return recorded(schema.nodes.table_row.create(null, (n as M.TableRow).children.map(block)), n);
      case "tableCell":
        return textblock("table_cell", null, n as M.TableCell);
      default:
        return recorded(schema.nodes.raw_block.create({ source: sourceOf(n), kind: n.type }), n);
    }
  };

  const doc = schema.nodes.doc.create(null, root.children.map(block));
  ranges.set(doc, { start: 0, end: text.length });
  disjoinSiblings(doc, ranges);
  return { text, bom, eol, doc, ranges, chars, style: detectStyle(text, root) };
}

/** Text in the document model uses "\n" whatever the file uses; the file's line ending is restored on save. */
function withoutCarriageReturns(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/** mdast can give siblings overlapping spans (a definition inside a setext heading); clamps each to start after the previous. */
function disjoinSiblings(doc: Node, ranges: WeakMap<Node, Range>): void {
  const clamp = (node: Node) => {
    let previousEnd = -1;
    node.forEach((child) => {
      const r = ranges.get(child);
      if (!r) return;
      if (r.start < previousEnd) r.start = previousEnd;
      previousEnd = r.end;
    });
  };
  clamp(doc);
  doc.descendants((node) => {
    if (node.isTextblock) return false;
    clamp(node);
    return true;
  });
}
