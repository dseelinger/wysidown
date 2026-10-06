import { byteOrderMark } from "../text/byte-order-mark.ts";
import type { Mark, Node } from "prosemirror-model";
import { schema } from "./schema.ts";
import type { MarkdownSource } from "./source.ts";
import { verify } from "./verify.ts";
import { writeBlocks } from "./write.ts";

/** How much was rewritten to produce a verified result, from least to most. */
export type Step = "minimal" | "inline" | "block" | "neighbours";

export interface SaveResult {
  /** The file text, with the original byte order mark and line endings. */
  text: string;
  /** True when `text` parses back to `doc`. */
  verified: boolean;
  /** The step that produced `text`. */
  step: Step;
}

export interface WriteOptions {
  /** Splice a text-only edit into the textblock's source. */
  inlineSplice: boolean;
  /** Rewrite only a textblock's inline content, keeping its own syntax from the source. */
  inlineRewrite: boolean;
  /** Rewrite an inserted or deleted region together with its neighbouring blocks. */
  widen: boolean;
  /** Walk unchanged containers instead of copying them whole. */
  forceDescend?: boolean;
}

const steps: readonly { step: Step; options: WriteOptions }[] = [
  { step: "minimal", options: { inlineSplice: true, inlineRewrite: true, widen: false } },
  { step: "inline", options: { inlineSplice: false, inlineRewrite: true, widen: false } },
  { step: "block", options: { inlineSplice: false, inlineRewrite: false, widen: false } },
  { step: "neighbours", options: { inlineSplice: true, inlineRewrite: true, widen: true } },
  { step: "neighbours", options: { inlineSplice: false, inlineRewrite: false, widen: true } },
];

/**
 * Writes `doc`, an edited version of `source.doc`, keeping the source bytes of everything that was
 * not edited. Each step rewrites more than the one before; the first whose output parses back to
 * `doc` is returned. When none does, the edit cannot be expressed in markdown as the document
 * model states it (deleting a definition that other blocks refer to, for example), and the
 * first step's output is returned unverified.
 */
export function serializeMarkdown(source: MarkdownSource, doc: Node): SaveResult {
  let first: SaveResult | null = null;
  for (const { step, options } of steps) {
    const text = writeMarkdown(source, doc, options);
    if (verify(source, doc, text)) return { text, verified: true, step };
    first ??= { text, verified: false, step };
  }
  return first!;
}

/** One write of `doc` against `source` with the given options, unverified. */
export function writeMarkdown(source: MarkdownSource, doc: Node, options: WriteOptions): string {
  const text = source.text;
  const range = (n: Node) => source.ranges.get(n)!;
  const slice = (n: Node) => text.slice(range(n).start, range(n).end);
  const blankLine = /\n[ \t>]*\r?\n/;

  /** Prefixes every line after the first with `prefix` and converts line endings to the file's. */
  const indent = (block: string, prefix: string) =>
    block
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line, i) => (i === 0 ? line : line === "" ? prefix.trimEnd() : prefix + line))
      .join(source.eol);

  /** Writes one new or changed node from scratch; null for nodes that only exist inside a table. */
  const rewrite = (n: Node, prefix: string, parent: Node | null, index: number): string | null => {
    if (n.type.name === "table_row" || n.type.name === "table_cell") return null;
    if (n.type.name === "doc") {
      const blocks = indent(writeBlocks(childNodes(n), source.style), prefix);
      return source.doc.childCount === 0 ? blocks + text : blocks;
    }
    if (n.type.name === "list_item" && parent) {
      const ordered = parent.attrs["ordered"] as boolean;
      const start = ordered ? ((parent.attrs["start"] as number | null) ?? 1) + index : null;
      return indent(writeBlocks([schema.nodes.list.create({ ...parent.attrs, start }, n)], source.style), prefix);
    }
    return indent(writeBlocks([n], source.style), prefix);
  };

  /** The prefix of continuation lines inside `container`, given the prefix of the container's own lines. */
  const childPrefix = (container: Node, prefix: string): string => {
    const r = range(container);
    if (container.type.name === "blockquote") return prefix + (/^>[ \t]?/.exec(text.slice(r.start))?.[0] ?? "> ");
    if (container.type.name !== "list_item") return prefix;
    const first = container.firstChild ? range(container.firstChild) : null;
    const head = first ? text.slice(r.start, first.start) : "";
    if (!first || head.includes("\n")) {
      const marker = /^(?:[-*+]|\d+[.)])/.exec(text.slice(r.start))?.[0] ?? "-";
      return prefix + " ".repeat(marker.length + 1);
    }
    const box = container.attrs["checked"] === null ? 0 : (/\[[ xX]\][ \t]*$/.exec(head)?.[0].length ?? 0);
    return prefix + " ".repeat(head.length - box);
  };

  /** Writes `edited` in place of `original`, or returns null when the caller must rewrite it. */
  const emit = (original: Node, edited: Node, prefix: string): string | null => {
    const container = !original.isLeaf && !original.isTextblock;
    if (original === edited && !(options.forceDescend && container)) return slice(original);
    if (original.type !== edited.type) return null;
    if (edited.isTextblock) {
      if (!sameAttrs(original, edited)) return null;
      if (original.eq(edited)) return slice(original);
      return (
        (options.inlineSplice ? spliceInline(original, edited) : null) ??
        (options.inlineRewrite ? rewriteInline(original, edited, prefix) : null)
      );
    }
    if (edited.isLeaf) return original.eq(edited) ? slice(original) : null;
    let head: ((gap: string) => string) | null = null;
    if (!sameAttrs(original, edited)) {
      const toggled =
        original.type.name === "list_item" &&
        sameAttrs(original, edited, ["checked"]) &&
        original.attrs["checked"] !== null &&
        edited.attrs["checked"] !== null;
      if (!toggled) return null;
      head = (gap) => gap.replace(/\[[ xX]\]/, edited.attrs["checked"] ? "[x]" : "[ ]");
    }
    return emitChildren(original, edited, childPrefix(original, prefix), head);
  };

  const emitChildren = (
    original: Node,
    edited: Node,
    prefix: string,
    head: ((gap: string) => string) | null,
  ): string | null => {
    const r = range(original);
    const before = childNodes(original);
    const after = childNodes(edited);
    const n = before.length;
    const m = after.length;
    if (n === 0) return m === 0 ? slice(original) : null;

    const spans = before.map(range);
    const gaps = [text.slice(r.start, spans[0]!.start)];
    for (let k = 1; k < n; k++) gaps.push(text.slice(spans[k - 1]!.end, spans[k]!.start));
    gaps.push(text.slice(spans[n - 1]!.end, r.end));
    if (head) gaps[0] = head(gaps[0]!);
    const kept = (k: number) => slice(before[k]!);

    let i = 0;
    while (i < n && i < m && before[i] === after[i]) i++;
    let j = 0;
    while (j < n - i && j < m - i && before[n - 1 - j] === after[m - 1 - j]) j++;
    const removed = n - i - j;
    const added = m - i - j;

    if (removed === added) {
      let out = gaps[0]!;
      for (let k = 0; k < n; k++) {
        const written = emit(before[k]!, after[k]!, prefix) ?? rewrite(after[k]!, prefix, edited, k);
        if (written === null) return null;
        out += written + gaps[k + 1]!;
      }
      return out;
    }

    const isList = original.type.name === "list";
    const separator = isList
      ? (gaps.slice(1, n).find((g) => g.includes("\n")) ?? source.eol + prefix)
      : (gaps.slice(1, n).find((g) => blankLine.test(g)) ?? source.eol + prefix.trimEnd() + source.eol + prefix);
    /** A gap that keeps the blocks on each side apart. */
    const apart = (gap: string) => (isList || blankLine.test(gap) ? gap : separator);

    if (options.widen && !["list", "table", "table_row"].includes(original.type.name)) {
      const lo = Math.max(0, i - 1);
      const hiBefore = Math.min(n, n - j + 1);
      const hiAfter = Math.min(m, m - j + 1);
      let out = gaps[0]!;
      for (let k = 0; k < lo; k++) out += kept(k) + gaps[k + 1]!;
      out += indent(writeBlocks(after.slice(lo, hiAfter), source.style), prefix);
      for (let k = hiBefore; k < n; k++) out += gaps[k]! + kept(k);
      return out + gaps[n]!;
    }

    const fresh: string[] = [];
    for (let k = i; k < i + added; k++) {
      const written = rewrite(after[k]!, prefix, edited, k);
      if (written === null) return null;
      fresh.push(written);
    }

    let out = gaps[0]!;
    if (removed > 0 && added > 0) {
      for (let k = 0; k < i; k++) out += kept(k) + (k + 1 < i ? gaps[k + 1]! : apart(gaps[i]!));
      out += fresh.join(separator);
      for (let k = i + removed; k < n; k++) out += (k === i + removed ? apart(gaps[k]!) : gaps[k]!) + kept(k);
      return out + gaps[n]!;
    }
    if (added === 0) {
      if (i === 0 && removed === n) return null;
      if (i + removed < n) {
        for (let k = 0; k < i; k++)
          out += kept(k) + (k + 1 < i ? gaps[k + 1]! : apart(joinGaps(gaps[i]!, gaps[i + removed]!)));
        for (let k = i + removed; k < n; k++) out += kept(k) + gaps[k + 1]!;
        return out;
      }
      for (let k = 0; k < i; k++) out += kept(k) + (k + 1 < i ? gaps[k + 1]! : "");
      return out + gaps[n]!;
    }
    for (let k = 0; k < i; k++) out += kept(k) + (k + 1 < i ? gaps[k + 1]! : "");
    if (i > 0) out += separator;
    out += fresh.join(separator);
    if (i === n) return out + gaps[n]!;
    out += i > 0 ? apart(gaps[i]!) : separator;
    for (let k = i; k < n; k++) out += kept(k) + gaps[k + 1]!;
    return out;
  };

  /** Splices a text-only edit within one run of text into the textblock's source. */
  const spliceInline = (original: Node, edited: Node): string | null => {
    const map = source.chars.get(original);
    if (!map) return null;
    const a = flatten(original);
    const b = flatten(edited);
    let pre = 0;
    while (pre < a.length && pre < b.length && sameItem(a[pre]!, b[pre]!)) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && sameItem(a[a.length - 1 - suf]!, b[b.length - 1 - suf]!)) {
      suf++;
    }
    const removed = a.slice(pre, a.length - suf);
    const inserted = b.slice(pre, b.length - suf);
    if (inserted.some((x) => x.char === null || x.char === "\n" || x.char === "\r")) return null;
    const marks = inserted[0]?.marks ?? null;
    if (marks && inserted.some((x) => !sameMarks(x.marks, marks))) return null;

    let from: number;
    let to: number;
    if (removed.length > 0) {
      const runs = new Set(removed.map((_, k) => map.run[pre + k]));
      if (runs.size !== 1 || runs.has(-1)) return null;
      if (marks && !sameMarks(removed[0]!.marks, marks)) return null;
      from = map.start[pre]!;
      to = map.end[a.length - suf - 1]!;
    } else {
      const prev = pre > 0 ? a[pre - 1]! : null;
      const next = pre < a.length ? a[pre]! : null;
      if (prev?.char != null && map.run[pre - 1]! >= 0 && marks && sameMarks(prev.marks, marks)) {
        from = to = map.end[pre - 1]!;
      } else if (next?.char != null && map.run[pre]! >= 0 && marks && sameMarks(next.marks, marks)) {
        from = to = map.start[pre]!;
      } else {
        return null;
      }
    }
    const r = range(original);
    const insertedText = inserted.map((x) => x.char).join("");
    return text.slice(r.start, from) + escapeInline(insertedText) + text.slice(to, r.end);
  };

  /** Rewrites a textblock's inline content, keeping its own syntax (heading marker, cell pipes) from the source. */
  const rewriteInline = (original: Node, edited: Node, prefix: string): string | null => {
    const map = source.chars.get(original);
    if (!map || map.contentStart < 0 || map.contentEnd < 0) return null;
    let inline = writeBlocks([schema.nodes.paragraph.create(null, edited.content)], source.style);
    if (edited.type.name === "table_cell") inline = inline.replace(/(^|[^\\])\|/g, "$1\\|");
    const r = range(original);
    return text.slice(r.start, map.contentStart) + indent(inline, prefix) + text.slice(map.contentEnd, r.end);
  };

  const body = emit(source.doc, doc, "") ?? rewrite(doc, "", null, 0) ?? "";
  return (source.bom ? byteOrderMark : "") + body;
}

function childNodes(n: Node): Node[] {
  const out: Node[] = [];
  n.forEach((c) => out.push(c));
  return out;
}

/** Joins the end of the line before a deleted block to the blank lines and indentation after it. */
function joinGaps(before: string, after: string): string {
  const a = before.indexOf("\n");
  const b = after.indexOf("\n");
  return a < 0 || b < 0 ? after : before.slice(0, a) + after.slice(b);
}

function sameAttrs(a: Node, b: Node, ignore: readonly string[] = []): boolean {
  return Object.keys(a.attrs).every(
    (k) => ignore.includes(k) || JSON.stringify(a.attrs[k]) === JSON.stringify(b.attrs[k]),
  );
}

interface Item {
  /** One UTF-16 unit of text, or null for an atom. */
  char: string | null;
  node: Node;
  marks: readonly Mark[];
}

function flatten(block: Node): Item[] {
  const out: Item[] = [];
  block.forEach((n) => {
    if (n.isText) for (const char of n.text!.split("")) out.push({ char, node: n, marks: n.marks });
    else out.push({ char: null, node: n, marks: n.marks });
  });
  return out;
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((m, i) => m.eq(b[i]!));
}

function sameItem(a: Item, b: Item): boolean {
  if (!sameMarks(a.marks, b.marks)) return false;
  if (a.char === null || b.char === null) return a.char === b.char && a.node.eq(b.node);
  return a.char === b.char;
}

/** Backslash-escapes characters that could start markdown syntax inside a line. */
function escapeInline(value: string): string {
  return value.replace(/[\\`*_[\]<>&|~$]/g, "\\$&");
}
