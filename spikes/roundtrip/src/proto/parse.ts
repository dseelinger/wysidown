import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import type { Mark, Node as PMNode } from "prosemirror-model";
import type * as M from "mdast";
import { schema } from "./schema.ts";

export interface Range {
  start: number;
  end: number;
}

/** Per inline position of a textblock: source span and the text segment it belongs to (-1 for atoms). */
export interface CharMap {
  start: number[];
  end: number[];
  seg: number[];
  /** Source span of the inline content, delimiters included; -1 when unknown. */
  contentStart: number;
  contentEnd: number;
}

export interface Parsed {
  source: string;
  bom: boolean;
  eol: string;
  doc: PMNode;
  ranges: WeakMap<PMNode, Range>;
  chars: WeakMap<PMNode, CharMap>;
  style: Style;
}

export interface Style {
  bullet: "-" | "*" | "+";
  emphasis: "*" | "_";
  strong: "*" | "_";
  fence: "`" | "~";
  rule: "-" | "*" | "_";
}

export function parseMdast(source: string): M.Root {
  return fromMarkdown(source, {
    extensions: [gfm(), frontmatter(["yaml", "toml"]), math()],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(["yaml", "toml"]), mathFromMarkdown()],
  });
}

export function parse(input: string): Parsed {
  const bom = input.startsWith("﻿");
  const source = bom ? input.slice(1) : input;
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const ranges = new WeakMap<PMNode, Range>();
  const chars = new WeakMap<PMNode, CharMap>();
  const root = parseMdast(source);
  let seg = 0;

  const range = (n: M.Node): Range => ({
    start: n.position!.start.offset!,
    end: n.position!.end.offset!,
  });
  const slice = (n: M.Node) => source.slice(n.position!.start.offset!, n.position!.end.offset!);
  const record = (pm: PMNode, n: M.Node) => {
    ranges.set(pm, range(n));
    return pm;
  };

  interface Item {
    node: PMNode;
    start: number[];
    end: number[];
    seg: number[];
  }

  const atom = (node: PMNode, n: M.Node): Item => {
    const r = n.position ? range(n) : { start: -1, end: -1 };
    return { node, start: [r.start], end: [r.end], seg: [-1] };
  };

  const text = (value: string, marks: readonly Mark[], from: number, to: number): Item | null => {
    if (value === "") return null;
    const map = from >= 0 ? mapText(source, from, to, value) : null;
    const id = seg++;
    const len = value.length;
    return {
      node: schema.text(value, marks),
      start: map ? map.start : new Array<number>(len).fill(-1),
      end: map ? map.end : new Array<number>(len).fill(-1),
      seg: new Array<number>(len).fill(map ? id : -1),
    };
  };

  const inline = (nodes: M.PhrasingContent[], marks: readonly Mark[], out: Item[]) => {
    for (const n of nodes) {
      const r = n.position ? range(n) : { start: -1, end: -1 };
      switch (n.type) {
        case "text": {
          const it = text(n.value, marks, r.start, r.end);
          if (it) out.push(it);
          break;
        }
        case "inlineCode": {
          const raw = slice(n);
          const ticks = /^`+/.exec(raw)![0].length;
          let from = r.start + ticks;
          let to = r.end - ticks;
          if (source.slice(from, to) !== n.value && source[from] === " " && source[to - 1] === " ") {
            from++;
            to--;
          }
          const it = text(n.value, schema.marks.code!.create().addToSet(marks), from, to);
          if (it) out.push(it);
          else out.push(atom(schema.nodes.raw_inline!.create({ source: raw }, null, marks), n));
          break;
        }
        case "emphasis":
          inline(n.children, schema.marks.em!.create().addToSet(marks), out);
          break;
        case "strong":
          inline(n.children, schema.marks.strong!.create().addToSet(marks), out);
          break;
        case "delete":
          inline(n.children, schema.marks.strike!.create().addToSet(marks), out);
          break;
        case "link":
          inline(n.children, schema.marks.link!.create({ href: n.url, title: n.title ?? null }).addToSet(marks), out);
          break;
        case "linkReference":
          inline(
            n.children,
            schema.marks.link!
              .create({ identifier: n.identifier, label: n.label ?? null, referenceType: n.referenceType })
              .addToSet(marks),
            out,
          );
          break;
        case "break":
          out.push(atom(schema.nodes.hard_break!.create(null, null, marks), n));
          break;
        case "image":
          out.push(
            atom(schema.nodes.image!.create({ src: n.url, alt: n.alt ?? "", title: n.title ?? null }, null, marks), n),
          );
          break;
        default:
          out.push(atom(schema.nodes.raw_inline!.create({ source: n.position ? slice(n) : '' }, null, marks), n));
      }
    }
  };

  const textblock = (type: string, attrs: Record<string, unknown> | null, n: M.Parent) => {
    const items: Item[] = [];
    inline(n.children as M.PhrasingContent[], [], items);
    const pm = schema.nodes[type]!.create(attrs, items.map((i) => i.node));
    const kids = n.children;
    const first = kids[0]?.position;
    const last = kids[kids.length - 1]?.position;
    chars.set(pm, {
      start: items.flatMap((i) => i.start),
      end: items.flatMap((i) => i.end),
      seg: items.flatMap((i) => i.seg),
      contentStart: first ? first.start.offset! : -1,
      contentEnd: last ? last.end.offset! : -1,
    });
    return record(pm, n);
  };

  const block = (n: M.Node): PMNode => {
    switch (n.type) {
      case "paragraph":
        return textblock("paragraph", null, n as M.Paragraph);
      case "heading":
        return textblock("heading", { level: (n as M.Heading).depth }, n as M.Heading);
      case "thematicBreak":
        return record(schema.nodes.thematic_break!.create(), n);
      case "blockquote":
        return record(schema.nodes.blockquote!.create(null, (n as M.Blockquote).children.map(block)), n);
      case "list": {
        const l = n as M.List;
        return record(
          schema.nodes.list!.create(
            { ordered: !!l.ordered, start: l.start ?? null, spread: !!l.spread },
            l.children.map(block),
          ),
          n,
        );
      }
      case "listItem": {
        const li = n as M.ListItem;
        return record(
          schema.nodes.list_item!.create({ checked: li.checked ?? null, spread: !!li.spread }, li.children.map(block)),
          n,
        );
      }
      case "code": {
        const c = n as M.Code;
        return record(
          schema.nodes.code_block!.create(
            { lang: c.lang ?? null, meta: c.meta ?? null },
            c.value ? schema.text(c.value) : null,
          ),
          n,
        );
      }
      case "table": {
        const t = n as M.Table;
        return record(schema.nodes.table!.create({ align: t.align ?? [] }, t.children.map(block)), n);
      }
      case "tableRow":
        return record(schema.nodes.table_row!.create(null, (n as M.TableRow).children.map(block)), n);
      case "tableCell":
        return textblock("table_cell", null, n as M.TableCell);
      default:
        return record(schema.nodes.raw_block!.create({ source: slice(n), kind: n.type }), n);
    }
  };

  const doc = schema.nodes.doc!.create(null, root.children.map(block));
  ranges.set(doc, { start: 0, end: source.length });
  // mdast can give siblings overlapping spans (a definition inside a setext heading); make them disjoint.
  doc.descendants((n) => {
    let prev = -1;
    n.forEach((c) => {
      const r = ranges.get(c);
      if (!r) return;
      if (r.start < prev) r.start = prev;
      prev = r.end;
    });
    return !n.isTextblock;
  });
  return { source, bom, eol, doc, ranges, chars, style: detectStyle(source, root) };
}

const asciiPunct = /[!-/:-@[-`{-~]/;

/** Maps each UTF-16 unit of `value` to its span in `source[from, to)`; null when they cannot be aligned. */
export function mapText(source: string, from: number, to: number, value: string) {
  const start: number[] = [];
  const end: number[] = [];
  let p = from;
  for (let i = 0; i < value.length; ) {
    if (p >= to) return null;
    const c = source[p]!;
    const v = value[i]!;
    if (c === v) {
      start.push(p);
      end.push(p + 1);
      p++;
      i++;
      continue;
    }
    if (c === "\\" && source[p + 1] === v && asciiPunct.test(v)) {
      start.push(p);
      end.push(p + 2);
      p += 2;
      i++;
      continue;
    }
    if (c === "&") {
      const m = /^&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/.exec(
        source.slice(p, p + 40),
      );
      if (m) {
        const d = m[1]
          ? String.fromCodePoint(parseInt(m[1], 16))
          : m[2]
            ? String.fromCodePoint(parseInt(m[2], 10))
            : decodeNamedCharacterReference(m[3]!);
        if (d && value.startsWith(d, i)) {
          for (let k = 0; k < d.length; k++) {
            start.push(p);
            end.push(p + m[0].length);
          }
          i += d.length;
          p += m[0].length;
          continue;
        }
      }
    }
    const afterNewline = i > 0 && value[i - 1] === "\n";
    if (c === "\r" || ((c === " " || c === "\t") && (v === "\n" || afterNewline)) || (c === ">" && afterNewline)) {
      p++;
      continue;
    }
    return null;
  }
  return { start, end };
}

function detectStyle(source: string, root: M.Root): Style {
  const count = new Map<string, number>();
  const bump = (k: string) => count.set(k, (count.get(k) ?? 0) + 1);
  const walk = (n: M.Node) => {
    const at = n.position ? source[n.position.start.offset!] : undefined;
    if (n.type === "list" && !(n as M.List).ordered && at) bump("bullet" + at);
    if (n.type === "emphasis" && at) bump("em" + at);
    if (n.type === "strong" && at) bump("strong" + at);
    if (n.type === "code" && (at === "`" || at === "~")) bump("fence" + at);
    if (n.type === "thematicBreak" && at) bump("rule" + at);
    for (const c of (n as M.Parent).children ?? []) walk(c);
  };
  walk(root);
  const pick = <T extends string>(prefix: string, options: T[], fallback: T): T => {
    let best = fallback;
    let n = 0;
    for (const o of options) {
      const c = count.get(prefix + o) ?? 0;
      if (c > n) {
        best = o;
        n = c;
      }
    }
    return best;
  };
  return {
    bullet: pick("bullet", ["-", "*", "+"], "-"),
    emphasis: pick("em", ["*", "_"], "*"),
    strong: pick("strong", ["*", "_"], "*"),
    fence: pick("fence", ["`", "~"], "`"),
    rule: pick("rule", ["-", "*", "_"], "-"),
  };
}
