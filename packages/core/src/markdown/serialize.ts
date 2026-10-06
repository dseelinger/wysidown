import { byteOrderMark } from "../text/byte-order-mark.ts";
import { Fragment, type Mark, type Node } from "prosemirror-model";
import { schema } from "./schema.ts";
import type { CharMap, LinkSpan, MarkdownSource } from "./source.ts";
import { verify } from "./verify.ts";
import { writeBlocks, writeCell } from "./write.ts";

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
  const rewrite = (
    n: Node,
    prefix: string,
    parent: Node | null,
    index: number,
    was: Node | null = null,
  ): string | null => {
    if (n.type.name === "table_row" || n.type.name === "table_cell") return null;
    if (n.type.name === "doc") {
      const blocks = indent(writeBlocks(childNodes(n), source.style), prefix);
      return source.doc.childCount === 0 ? blocks + text : blocks;
    }
    if (n.type.name === "list_item" && parent) {
      const written = writeBlocks([schema.nodes.list.create({ ...parent.attrs, start: 1 }, n)], source.style);
      const m = /^([-*+]|\d+[.)])(?: |$)([^]*)$/.exec(written);
      const head = itemHead(parent, index, was);
      if (!m || m[2] === "") return head.trimEnd();
      const width = m[1]!.length + 1;
      const pad = " ".repeat(head.length);
      const lines = m[2]!
        .split("\n")
        .map((line, i) => (i === 0 ? head : line === "" ? "" : pad) + line.slice(i === 0 ? 0 : width));
      return indent(lines.join("\n"), prefix);
    }
    return indent(writeBlocks([n], source.style), prefix);
  };

  /**
   * Marker and spacing for item `index` of `list`, copied from its nearest unedited item, or from
   * `was`, the list as loaded. A list numbered all alike repeats its number; any other counts on
   * from the item before.
   */
  const itemHead = (list: Node, index: number, was: Node | null): string => {
    const headOf = (item: Node) => {
      const r = source.ranges.get(item);
      return r ? /^(?:([-*+])|(\d+)([.)]))([ \t]*)/.exec(text.slice(r.start, r.end)) : null;
    };
    const heads = childNodes(list).map(headOf);
    const loaded = was ? childNodes(was).map(headOf) : [];
    let found: RegExpExecArray | null = null;
    for (let k = index - 1; k >= 0 && !found; k--) found = heads[k] ?? null;
    for (let k = index + 1; k < heads.length && !found; k++) found = heads[k] ?? null;
    found ??= loaded[Math.min(Math.max(index - 1, 0), loaded.length - 1)] ?? null;
    const spacing = found && /^ {1,4}$/.test(found[4]!) ? found[4]! : " ";
    if (!(list.attrs["ordered"] as boolean)) return (found?.[1] ?? source.style.bullet) + spacing;
    const numbers = loaded.flatMap((h) => (h?.[2] === undefined ? [] : [Number(h[2])]));
    const repeated = numbers.length > 1 && numbers.every((x) => x === numbers[0]);
    const start = (list.attrs["start"] as number | null) ?? 1;
    const numberAt = (k: number): number => {
      if (k === 0) return start;
      if (repeated) return numbers[0]!;
      const kept = heads[k]?.[2];
      return kept === undefined ? numberAt(k - 1) + 1 : Number(kept);
    };
    const width = found?.[2]?.startsWith("0") ? found[2].length : 0;
    return String(numberAt(index)).padStart(width, "0") + (found?.[3] ?? ".") + spacing;
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
    if (edited.type.name === "code_block") return options.inlineRewrite ? emitCode(original, edited, prefix) : null;
    if (edited.isTextblock) {
      if (!sameAttrs(original, edited)) return null;
      if (original.eq(edited)) return slice(original);
      return (
        (options.inlineSplice ? (spliceInline(original, edited) ?? spliceLink(original, edited)) : null) ??
        (options.inlineRewrite ? rewriteInline(original, edited, prefix) : null)
      );
    }
    if (edited.isLeaf) return original.eq(edited) ? slice(original) : null;
    if (original.type.name === "table") return emitTable(original, edited, prefix);
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
        const written = emit(before[k]!, after[k]!, prefix) ?? rewrite(after[k]!, prefix, edited, k, original);
        if (written === null) return null;
        out += written + gaps[k + 1]!;
      }
      return out;
    }

    const isList = original.type.name === "list";
    /** For a list, the gap at the edit, so that a new item lines up with the items beside it. */
    const local = i > 0 && i < n ? gaps[i]! : i === n && n > 1 ? gaps[n - 1]! : "";
    const near = spans[Math.max(0, Math.min(i, n) - 1)]!.start;
    const lineHead = text.slice(text.lastIndexOf("\n", near - 1) + 1, near);
    const separator = isList
      ? local.includes("\n")
        ? local
        : (gaps.slice(1, n).find((g) => g.includes("\n")) ??
          source.eol + (/^[ \t>]*$/.test(lineHead) ? lineHead : prefix))
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
      const written = rewrite(after[k]!, prefix, edited, k, original);
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

  /**
   * Writes a textblock in which one link was added, removed or given a new target, rewriting only
   * that link's syntax and keeping its text as written. A link whose text changed as well takes the
   * text edit as `spliceInline` would. An autolink whose text still names its target stays an
   * autolink.
   */
  const spliceLink = (original: Node, edited: Node): string | null => {
    const map = source.chars.get(original);
    if (!map) return null;
    const a = flatten(original);
    const b = flatten(edited);
    let from = 0;
    while (from < a.length && from < b.length && sameItem(a[from]!, b[from]!)) from++;
    let suf = 0;
    while (suf < a.length - from && suf < b.length - from && sameItem(a[a.length - 1 - suf]!, b[b.length - 1 - suf]!)) {
      suf++;
    }
    let endA = a.length - suf;
    let endB = b.length - suf;
    const spans = linkSpans(b);
    if (from === endA && from < endB) return insertLink(original, a, b.slice(from, endB), from, spans);
    if (from === endA || from === endB) return null;

    /** Widens the changed stretch to take in a link that overlaps it; true when it grew. */
    const takeIn = (start: number, end: number, inOriginal: boolean) => {
      const own = inOriginal ? endA : endB;
      if (start >= own || end <= from) return false;
      const grow = Math.max(0, end - own);
      endA += grow;
      endB += grow;
      const earlier = start < from;
      if (earlier) from = start;
      return earlier || grow > 0;
    };
    for (let grew = true; grew;) {
      grew = false;
      for (const l of map.links) grew = takeIn(l.from, l.to, true) || grew;
      for (const l of spans) grew = takeIn(l.from, l.to, false) || grew;
    }

    const inA = map.links.filter((l) => l.from >= from && l.to <= endA);
    const inB = spans.filter((l) => l.from >= from && l.to <= endB);
    const old = inA.length === 1 && inA[0]!.from === from && inA[0]!.to === endA ? inA[0]! : null;
    const now = inB.length === 1 && inB[0]!.from === from && inB[0]!.to === endB ? linkOf(b[from]!) : null;
    const sameText =
      endA - from === endB - from && a.slice(from, endA).every((x, k) => sameExceptLink(x, b[from + k]!));
    const r = range(original);
    const at = (offset: number) => offset - r.start;
    const body = slice(original);

    if (!old) {
      // A new link around text that had none.
      if (!now || !sameText || inA.length > 0 || a.slice(from, endA).some((x) => linkOf(x))) return null;
      const start = map.start[from]!;
      const end = map.end[endA - 1]!;
      const written = linkTail(now);
      if (start < 0 || end < 0 || written === null) return null;
      return body.slice(0, at(start)) + "[" + body.slice(at(start), at(end)) + written + body.slice(at(end));
    }

    const bracketed = text[old.start] === "[";
    if (!now) {
      // A link taken off its text.
      if (!sameText || inB.length > 0 || !bracketed) return null;
      return body.slice(0, at(old.start)) + text.slice(old.textStart, old.textEnd) + body.slice(at(old.end));
    }

    const was = linkOf(a[from]!)!;
    if (!bracketed) {
      const shown = b.slice(from, endB).map((x) => x.char);
      if (shown.some((c) => c === null)) return null;
      const plain = shown.join("");
      const angle = text[old.start] === "<";
      let written: string | null;
      if (namesItsTarget(now, plain, angle) && (!angle || autolinkable(plain))) written = angle ? `<${plain}>` : plain;
      else {
        const tail = linkTail(now);
        const shownText = sameText ? text.slice(old.textStart, old.textEnd) : escapeInline(plain);
        written = tail === null ? null : "[" + shownText + tail;
      }
      if (written === null) return null;
      return body.slice(0, at(old.start)) + written + body.slice(at(old.end));
    }

    const retexted = sameText ? body : spliceInline(original, relink(edited, from, endB, was));
    const written = retargetTail(old, was, now);
    if (retexted === null || written === null) return null;
    const delta = retexted.length - body.length;
    return retexted.slice(0, at(old.textEnd + delta)) + written + retexted.slice(at(old.end + delta));
  };

  /**
   * Writes `original`, whose items are `a`, with the link `inserted` added at position `at`, next to
   * text with the same marks. A link whose text is its target is written as an autolink.
   */
  const insertLink = (
    original: Node,
    a: readonly Item[],
    inserted: readonly Item[],
    at: number,
    spans: readonly { from: number; to: number }[],
  ): string | null => {
    const map = source.chars.get(original);
    if (!map || !spans.some((l) => l.from === at && l.to === at + inserted.length)) return null;
    const now = linkOf(inserted[0]!)!;
    const marks = withoutLink(inserted[0]!.marks);
    if (inserted.some((x) => x.char === null || x.char === "\n" || !sameMarks(withoutLink(x.marks), marks)))
      return null;
    const next = (k: number) => {
      const x = a[k];
      return x?.char != null && map.run[k]! >= 0 && sameMarks(withoutLink(x.marks), marks) && !linkOf(x);
    };
    const offset = next(at - 1) ? map.end[at - 1]! : next(at) ? map.start[at]! : -1;
    if (offset < 0) return null;
    const shown = inserted.map((x) => x.char).join("");
    const angle = namesItsTarget(now, shown, true) && autolinkable(shown);
    const tail = angle ? "" : linkTail(now);
    if (tail === null) return null;
    const r = range(original);
    const written = angle ? `<${shown}>` : "[" + escapeInline(shown) + tail;
    return text.slice(r.start, offset) + written + text.slice(offset, r.end);
  };

  /** The syntax of `link` from the closing bracket of its text on; null when it cannot be written. */
  const linkTail = (link: Mark): string | null => {
    const identifier = link.attrs["identifier"] as string | null;
    if (identifier !== null) return `][${(link.attrs["label"] as string | null) ?? identifier}]`;
    const written = writeBlocks([schema.nodes.paragraph.create(null, schema.text("x", [link]))], source.style);
    return written.startsWith("[x](") && written.endsWith(")") ? written.slice(2) : null;
  };

  /**
   * The syntax of `link` in place of `old`'s, from the closing bracket of its text on. When both are
   * inline links with the same title, only the destination is rewritten.
   */
  const retargetTail = (old: LinkSpan, was: Mark, link: Mark): string | null => {
    const inline = was.attrs["identifier"] === null && link.attrs["identifier"] === null;
    const destination = inline && was.attrs["title"] === link.attrs["title"] ? destinationAt(text, old.textEnd) : null;
    if (!destination || destination.end > old.end) return linkTail(link);
    const bare = linkTail(schema.marks.link.create({ href: link.attrs["href"] as string }));
    if (bare === null) return null;
    return text.slice(old.textEnd, destination.start) + bare.slice(2, -1) + text.slice(destination.end, old.end);
  };

  /** Rewrites a textblock's inline content, keeping its own syntax (heading marker, cell pipes) from the source. */
  const rewriteInline = (original: Node, edited: Node, prefix: string): string | null => {
    const map = source.chars.get(original);
    if (edited.type.name === "table_cell") return rewriteCell(original, edited, map);
    if (!map || map.contentStart < 0 || map.contentEnd < 0) return null;
    const inline = writeBlocks([schema.nodes.paragraph.create(null, edited.content)], source.style);
    const r = range(original);
    return text.slice(r.start, map.contentStart) + indent(inline, prefix) + text.slice(map.contentEnd, r.end);
  };

  /** Rewrites a cell's content between its pipes and padding; an empty cell gets one space each side. */
  const rewriteCell = (original: Node, edited: Node, map: CharMap | undefined): string => {
    const cell = slice(original);
    const content = writeCell(edited, source.style);
    if (map && map.contentStart >= 0 && map.contentEnd >= 0) {
      const r = range(original);
      return cell.slice(0, map.contentStart - r.start) + content + cell.slice(map.contentEnd - r.start);
    }
    const [, pipe, space, rest] = /^(\|?)([ \t]*)([^]*)$/.exec(cell)!;
    if (content === "") return cell;
    return pipe! + " " + content + (space!.length > 1 ? space!.slice(1) : " ") + rest!;
  };

  /**
   * Writes an edited code block keeping its fences and the source of every unchanged line; a new
   * language rewrites only the info string, and an indented block given one is written fenced with
   * each line's prefix kept. Returns null for a line that would close the fence, and for source
   * lines that do not end with the code's lines.
   */
  const emitCode = (original: Node, edited: Node, prefix: string): string | null => {
    if (original.eq(edited)) return slice(original);
    const r = range(original);
    /** The block's lines from the start of its first line; `end` is before the line ending. */
    const lines: { start: number; end: number }[] = [];
    for (let at = text.lastIndexOf("\n", r.start - 1) + 1; at <= r.end;) {
      const nl = text.indexOf("\n", at);
      const stop = nl < 0 || nl >= r.end ? r.end : nl;
      lines.push({ start: at, end: stop > at && text[stop - 1] === "\r" ? stop - 1 : stop });
      at = stop + 1;
    }
    const lineText = (k: number) => text.slice(lines[k]!.start, lines[k]!.end);
    const open = /^(`{3,}|~{3,})([ \t]*)([^\r\n]*)$/.exec(text.slice(r.start, lines[0]!.end));
    const fence = open?.[1] ?? "";
    /** True when `line`, after the prefix `lead` matches, would close the fence. */
    const closer = (line: string, lead: RegExp) => {
      const m = new RegExp(lead.source + /(`+|~+)[ \t]*$/.source).exec(line);
      return m !== null && fence !== "" && m[1]!.startsWith(fence.charAt(0)) && m[1]!.length >= fence.length;
    };

    const from = open ? 1 : 0;
    let to = lines.length - (open && lines.length > 1 && closer(lineText(lines.length - 1), /^[ \t>]*/) ? 1 : 0);
    const value = original.textContent;
    let values = value === "" ? [] : value.split("\n");
    if (value === "" && to - from === 1) values = [""];
    else if (to - from === values.length + 1 && lineText(to - 1) === "") to--;
    if (to - from !== values.length) return null;
    const content = lines.slice(from, to);
    const prefixes: string[] = [];
    for (let k = 0; k < content.length; k++) {
      const line = lineText(from + k);
      const lead = prefixOf(line, values[k]!);
      if (lead === null) return null;
      prefixes.push(lead);
    }

    const ownLine = /^[ \t>]*$/.test(text.slice(lines[0]!.start, r.start));
    const usable = values.flatMap((v, k) => (v !== "" && (open || k > 0 || ownLine) ? [k] : []));
    /** The prefix for a new line `k`, from the nearest line that has content. */
    const prefixAt = (k: number) => {
      if (!open && k === 0) return prefixes[0]!.slice(r.start - content[0]!.start);
      let best: number | null = null;
      for (const u of usable) if (best === null || Math.abs(u - k) < Math.abs(best - k)) best = u;
      return best === null ? prefix + (open ? "" : "    ") : prefixes[best]!;
    };
    const lang = edited.attrs["lang"] as string | null;
    const meta = edited.attrs["meta"] as string | null;
    if ((lang === null && meta !== null) || (lang !== null && /\s/.test(lang))) return null;

    if (!open && !sameAttrs(original, edited)) {
      const outdent = (lead: string) => untilColumn(lead, width(lead) - 4);
      const first = outdent(prefixes[0]!);
      const body = outdent(prefixAt(1));
      if (first === null || body === null) return null;
      // The fence goes where `first` ends, or, when the text before the block reaches past that, up
      // to three columns later with every line indented to match.
      const head = text.slice(content[0]!.start, r.start);
      const past = width(head) - width(first);
      if (past > 3) return null;
      const lead = first.startsWith(head) ? first.slice(head.length) : " ".repeat(Math.max(0, -past));
      const indent = " ".repeat(Math.max(0, past));
      const now = edited.textContent.split("\n");
      const style = source.style.fence;
      const char = lang?.includes(style) ? (style === "`" ? "~" : "`") : style;
      const run = char === "`" ? /^[ \t]*(`*)/ : /^[ \t]*(~*)/;
      const runs = now.map((line) => run.exec(line)![1]!.length);
      const written = char.repeat(Math.max(3, ...runs.map((run) => run + 1)));
      return [
        lead + written + (lang ?? "") + (meta === null ? "" : ` ${meta}`),
        ...now.map((line) => (line === "" ? body.trimEnd() : body + indent + line)),
        body + indent + written,
      ].join(source.eol);
    }

    let out = slice(original);
    const replace = (start: number, end: number, by: string) => {
      out = out.slice(0, start - r.start) + by + out.slice(end - r.start);
    };

    if (!original.content.eq(edited.content)) {
      const now = edited.textContent === "" ? [] : edited.textContent.split("\n");
      const n = values.length;
      const m = now.length;
      let i = 0;
      while (i < n && i < m && values[i] === now[i]) i++;
      let j = 0;
      while (j < n - i && j < m - i && values[n - 1 - j] === now[m - 1 - j]) j++;
      // The first line of an indented block holds whatever precedes the block on its line.
      if (!open && i === 0 && (m - j === 0 || n - j === 0)) return null;
      if (open && now.slice(i, m - j).some((line) => closer(line, /^ {0,3}/))) return null;
      const written = now
        .slice(i, m - j)
        .map((line, k) => (line === "" ? prefixAt(i + k).trimEnd() : prefixAt(i + k) + line))
        .join(source.eol);
      const before = i > 0 ? content[i - 1]!.end : lines[0]!.end;
      if (i < n - j) {
        if (m - j > i) replace(Math.max(content[i]!.start, r.start), content[n - 1 - j]!.end, written);
        else replace(before, content[n - 1 - j]!.end, "");
      } else {
        replace(before, before, source.eol + written);
      }
    }

    if (open && !sameAttrs(original, edited)) {
      if (fence.startsWith("`") && lang?.includes("`")) return null;
      const info = open[3]!;
      const kept = meta === original.attrs["meta"];
      const rest = kept ? info.slice(/^\S*/.exec(info)![0].length) : meta === null ? "" : ` ${meta}`;
      const start = r.start + fence.length;
      replace(start, start + open[2]!.length + info.length, lang === null ? "" : open[2]! + lang + rest);
    }
    return out;
  };

  /** One line of a table: its cells' text between the pipes, and whether it has outer pipes. */
  interface Line {
    head: string;
    lead: boolean;
    inners: string[];
    trail: boolean;
    tail: string;
  }

  /**
   * Writes `line` with new `inners`, where `map` gives the index each came from among the line's
   * `count` cells. An empty cell at either end gets an outer pipe, without which it would not be a
   * cell, and the one cell left of several keeps the pipe it had beside it, without which the line
   * would not be a table row. A cell that moves to or from an end with no outer pipe loses or gains
   * the space beside that pipe.
   */
  const joinLine = (
    line: Line,
    inners: readonly string[],
    map: readonly (number | null)[],
    count: number,
    spaced: boolean,
  ): string => {
    const last = inners.length - 1;
    const blank = (k: number) => inners[k]!.trim() === "";
    const lone = inners.length === 1 && count > 1 && !line.lead && !line.trail;
    const lead = line.lead || (lone && map[0] !== 0) || blank(0);
    const trail = line.trail || (lone && map[0] === 0) || blank(last);
    const space = spaced ? " " : "";
    const written = inners.map((inner, k) => {
      if (blank(k)) return inner;
      const o = map[k];
      const wasFirst = o === 0 && !line.lead;
      const wasLast = o === count - 1 && !line.trail;
      let s = inner;
      if (k === 0 && !lead && !wasFirst) s = s.trimStart();
      else if (wasFirst && (k > 0 || lead) && !/^[ \t]/.test(s)) s = space + s;
      if (k === last && !trail && !wasLast) s = s.trimEnd();
      else if (wasLast && (k < last || trail) && !/[ \t]$/.test(s)) s = s + space;
      return s;
    });
    return line.head + (lead ? "|" : "") + written.join("|") + (trail ? "|" : "") + line.tail;
  };

  /**
   * Cell `k` of `count` without the pipes around it or the spaces after a closing pipe; null when
   * the pipes are not where `line` says.
   */
  const innerOf = (cell: string, k: number, count: number, line: Pick<Line, "lead" | "trail">): string | null => {
    let inner = cell;
    if (k > 0 || line.lead) {
      if (!inner.startsWith("|")) return null;
      inner = inner.slice(1);
    }
    if (k === count - 1 && line.trail) {
      const pipe = /\|[ \t]*$/.exec(inner);
      if (!pipe) return null;
      inner = inner.slice(0, pipe.index);
    }
    return inner;
  };

  const rowLine = (row: Node): Line | null => {
    const cells = childNodes(row);
    if (cells.length === 0) return null;
    const r = range(row);
    const first = range(cells[0]!);
    const last = cells[cells.length - 1]!;
    const lead = slice(cells[0]!).startsWith("|");
    const map = source.chars.get(last);
    const lastText = slice(last);
    const afterContent =
      map && map.contentEnd >= 0
        ? text.slice(map.contentEnd, range(last).end)
        : lastText.slice(cells.length > 1 || lead ? 1 : 0);
    const line = { lead, trail: /^[ \t]*\|[ \t]*$/.test(afterContent) };
    const inners: string[] = [];
    for (let k = 0; k < cells.length; k++) {
      const inner = innerOf(slice(cells[k]!), k, cells.length, line);
      if (inner === null) return null;
      inners.push(inner);
    }
    const tail = (line.trail ? /[ \t]*$/.exec(lastText)![0] : "") + text.slice(range(last).end, r.end);
    return { ...line, inners, head: text.slice(r.start, first.start), tail };
  };

  /**
   * Writes an edited table row by row and cell by cell. Unedited rows and cells keep their source,
   * padding included; new rows and cells take the table's spacing, and are padded to the column
   * width when every line of the table is. The delimiter row changes only for an added, removed or
   * realigned column. Returns null when the header row was removed or a row was added above it.
   */
  const emitTable = (original: Node, edited: Node, prefix: string): string | null => {
    const before = childNodes(original);
    const after = childNodes(edited);
    const n = before.length;
    const rows = pair(before, after, shareACell);
    if (n === 0 || rows[0] !== 0) return null;
    const r = range(original);
    const spans = before.map(range);
    const gaps = [text.slice(r.start, spans[0]!.start)];
    for (let k = 1; k < n; k++) gaps.push(text.slice(spans[k - 1]!.end, spans[k]!.start));
    gaps.push(text.slice(spans[n - 1]!.end, r.end));

    const afterHeader = gaps[1]!;
    const lineFrom = afterHeader.indexOf("\n") + 1;
    const delimiterAt = lineFrom > 0 ? afterHeader.slice(lineFrom).search(/[|:-]/) : -1;
    if (delimiterAt < 0) return null;
    const delimiterFrom = lineFrom + delimiterAt;
    const delimiterTo = delimiterFrom + /^[|:\- \t]*[|:-]/.exec(afterHeader.slice(delimiterFrom))![0].length;
    const delimiterText = afterHeader.slice(delimiterFrom, delimiterTo);
    const lead = delimiterText.startsWith("|");
    const trail = delimiterText.length > 1 && delimiterText.endsWith("|");
    const delimiter: Line = {
      head: "",
      lead,
      inners: delimiterText.slice(lead ? 1 : 0, trail ? -1 : undefined).split("|"),
      trail,
      tail: "",
    };
    const header = rowLine(before[0]!);
    const columnCount = before[0]!.childCount;
    if (!header || delimiter.inners.length !== columnCount) return null;
    const bodyLines = before.slice(1).map(rowLine);

    const spaced = header.inners.some((inner) => /^[ \t]/.test(inner));
    const full = [header, delimiter, ...bodyLines].filter((l) => l?.inners.length === columnCount);
    const widths = header.inners.map((_, k) => {
      const shown = full.map((l) => columns(l!.inners[k]!));
      return shown.every((w) => w === shown[0]) ? shown[0]! : null;
    });
    const padded = widths.every((w) => w !== null);
    const oldAlign = original.attrs["align"] as (string | null)[];
    const align = edited.attrs["align"] as (string | null)[];
    const columnMap =
      before[0] === after[0] ? widths.map((_, k) => k) : pair(childNodes(before[0]!), childNodes(after[0]!));

    /** `content` with the table's spacing, padded to the width of column `k` when the table is padded. */
    const pad = (content: string, k: number) => {
      const body = spaced ? ` ${content} ` : content;
      const o = columnMap[k];
      const width = !padded || o === undefined ? 0 : o === null ? 3 + (spaced ? 2 : 0) : widths[o]!;
      const room = width - columns(body);
      if (room <= 0) return content === "" && spaced ? " " : body;
      return body + " ".repeat(room);
    };
    const freshCell = (cell: Node, k: number) => pad(writeCell(cell, source.style), k);

    const emitRow = (was: Node, row: Node, line: Line): string | null => {
      if (was === row && !options.forceDescend) return slice(was);
      const cells = childNodes(was);
      const now = childNodes(row);
      if (now.length === 0) return null;
      const map = pair(cells, now);
      const inners = now.map((cell, k) => {
        const o = map[k] ?? null;
        if (o === null) return freshCell(cell, k);
        const written = emit(cells[o]!, cell, prefix);
        return (written === null ? null : innerOf(written, o, cells.length, line)) ?? freshCell(cell, k);
      });
      return joinLine(line, inners, map, cells.length, spaced);
    };
    const writeRow = (row: Node) => {
      const inners = childNodes(row).map(freshCell);
      return joinLine({ ...header, head: "", tail: "" }, inners, [], 0, spaced);
    };

    /** Rewrites a delimiter cell for the alignment of column `k`, keeping its width where it can. */
    const realign = (inner: string, k: number) => {
      const [, before, dashes, after] = /^([ \t]*)(:?-+:?)([ \t]*)$/.exec(inner) ?? ["", "", "---", ""];
      const left = align[k] === "left" || align[k] === "center" ? ":" : "";
      const right = align[k] === "right" || align[k] === "center" ? ":" : "";
      const width = Math.max(dashes.length, left.length + right.length + 1);
      return before + left + "-".repeat(width - left.length - right.length) + right + after;
    };
    const delimiterSpaced = delimiter.inners.some((inner) => /^[ \t]/.test(inner));
    const space = delimiterSpaced ? " " : "";
    const newDelimiter = space + "-".repeat(padded ? (spaced ? 5 : 3) - space.length * 2 : 3) + space;
    if (columnMap.length !== align.length) return null;
    const delimiterInners = columnMap.map((o, k) =>
      o !== null && oldAlign[o] === align[k]
        ? delimiter.inners[o]!
        : realign(o === null ? newDelimiter : delimiter.inners[o]!, k),
    );

    const headerOut = emitRow(before[0]!, after[0]!, header);
    if (headerOut === null) return null;
    const rowSeparator = source.eol + afterHeader.slice(lineFrom, delimiterFrom);
    /** The gap after original row `o`; row 0's is the one after the delimiter row. */
    const gapAfter = (o: number) => (o === 0 ? afterHeader.slice(delimiterTo) : gaps[o + 1]!);
    const lineEnd = (gap: string) => /\r?\n/.exec(gap)?.index ?? gap.length;
    /** The end of the line before a gap, and the line ending and prefix after another. */
    const join = (a: string, b: string) => a.slice(0, lineEnd(a)) + b.slice(lineEnd(b));

    let out =
      gaps[0]! +
      headerOut +
      afterHeader.slice(0, delimiterFrom) +
      joinLine(delimiter, delimiterInners, columnMap, columnCount, delimiterSpaced);
    let previous: number | null = 0;
    for (let k = 1; k < after.length; k++) {
      const o = rows[k] ?? null;
      const written =
        o === null ? writeRow(after[k]!) : bodyLines[o - 1] ? emitRow(before[o]!, after[k]!, bodyLines[o - 1]!) : null;
      if (written === null) return null;
      out += join(previous === null ? "" : gapAfter(previous), o === null ? rowSeparator : gapAfter(o - 1)) + written;
      previous = o;
    }
    return out + join(previous === null ? "" : gapAfter(previous), gapAfter(n - 1));
  };

  const body = emit(source.doc, doc, "") ?? rewrite(doc, "", null, 0) ?? "";
  return (source.bom ? byteOrderMark : "") + body;
}

function childNodes(n: Node): Node[] {
  const out: Node[] = [];
  n.forEach((c) => out.push(c));
  return out;
}

/**
 * For each node of `after`, the index of the node of `before` it is written from, or null for a new
 * node. Unchanged nodes at either end pair with themselves. Between them, a node pairs with the
 * next node `related` to it, and the nodes left over between two pairs pair by position.
 */
function pair(
  before: readonly Node[],
  after: readonly Node[],
  related: (was: Node, now: Node) => boolean = () => false,
): (number | null)[] {
  const n = before.length;
  const m = after.length;
  let i = 0;
  while (i < n && i < m && before[i] === after[i]) i++;
  let j = 0;
  while (j < n - i && j < m - i && before[n - 1 - j] === after[m - 1 - j]) j++;
  const out = after.map((_, k): number | null => (k < i ? k : k >= m - j ? k - m + n : null));
  let from = i;
  for (let k = i; k < m - j; k++) {
    for (let o = from; o < n - j; o++) {
      if (!related(before[o]!, after[k]!)) continue;
      out[k] = o;
      from = o + 1;
      break;
    }
  }
  let previous = i - 1;
  for (let k = i; k < m - j; k++) {
    const o = out[k];
    if (o !== null && o !== undefined) {
      previous = o;
      continue;
    }
    let next = k;
    while (next < m - j && out[next] === null) next++;
    const limit = next < m - j ? out[next]! : n - j;
    for (let t = k; t < next && previous + 1 < limit; t++) out[t] = ++previous;
    k = next - 1;
  }
  return out;
}

/** True when two rows share a cell. */
function shareACell(was: Node, now: Node): boolean {
  const cells = new Set<Node>();
  was.forEach((cell) => cells.add(cell));
  let shared = false;
  now.forEach((cell) => (shared ||= cells.has(cell)));
  return shared;
}

/** East Asian wide and fullwidth code points, as inclusive ranges. */
const wideRanges: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
];
const emoji = /^\p{Emoji_Presentation}$/u;
const mark = /^\p{M}$/u;
const zeroWidthJoiner = 0x200d;
const textPresentation = 0xfe0e;
const emojiPresentation = 0xfe0f;

/** How many columns `s` takes in a monospaced font: emoji and East Asian wide characters take two. */
function columns(s: string): number {
  let width = 0;
  let last = 0;
  for (const c of s) {
    const code = c.codePointAt(0)!;
    if (code === emojiPresentation) {
      width += last === 1 ? 1 : 0;
      last = 0;
      continue;
    }
    const zero = code === zeroWidthJoiner || code === textPresentation || mark.test(c);
    const wide = emoji.test(c) || wideRanges.some(([from, to]) => code >= from && code <= to);
    last = zero ? 0 : wide ? 2 : 1;
    width += last;
  }
  return width;
}

/**
 * `line` up to the column where `value`, which ends it, starts. Leading spaces of `value` may
 * stand for part of a tab in `line`; a tab across that column becomes spaces. Null when `line`
 * does not end with `value`.
 */
function prefixOf(line: string, value: string): string | null {
  if (line.endsWith(value)) return line.slice(0, line.length - value.length);
  const core = value.replace(/^ +/, "");
  if (!line.endsWith(core)) return null;
  const lead = line.slice(0, line.length - core.length);
  return untilColumn(lead, width(lead) - (value.length - core.length));
}

/** The column after `c` written at column `col`; tab stops are four columns apart. */
function advance(col: number, c: string): number {
  return c === "\t" ? col + 4 - (col % 4) : col + 1;
}

/** How many columns `lead` takes from the start of a line. */
function width(lead: string): number {
  let col = 0;
  for (const c of lead) col = advance(col, c);
  return col;
}

/** `lead` up to column `target`; a tab across it becomes spaces. Null when `lead` ends before it. */
function untilColumn(lead: string, target: number): string | null {
  let out = "";
  let col = 0;
  for (const c of lead) {
    if (col >= target) break;
    const next = advance(col, c);
    out += next > target ? " ".repeat(target - col) : c;
    col = Math.min(next, target);
  }
  return col === target ? out : null;
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

function linkOf(item: Item): Mark | null {
  return item.marks.find((m) => m.type === schema.marks.link) ?? null;
}

/** The stretches of `items` under one link, as positions. */
function linkSpans(items: readonly Item[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (let k = 0; k < items.length;) {
    const link = linkOf(items[k]!);
    let end = k + 1;
    if (link) {
      while (end < items.length && linkOf(items[end]!)?.eq(link)) end++;
      out.push({ from: k, to: end });
    }
    k = end;
  }
  return out;
}

/** True when two items are the same but for their link. */
function sameExceptLink(a: Item, b: Item): boolean {
  if (!sameMarks(withoutLink(a.marks), withoutLink(b.marks))) return false;
  if (a.char === null || b.char === null) return a.char === b.char && a.node.mark([]).eq(b.node.mark([]));
  return a.char === b.char;
}

/** `block` with positions `from` to `to` of its content under `link` in place of their own link. */
function relink(block: Node, from: number, to: number, link: Mark): Node {
  const middle: Node[] = [];
  block.content.cut(from, to).forEach((n) => middle.push(n.mark(link.addToSet(n.marks))));
  return block.copy(block.content.cut(0, from).append(Fragment.from(middle)).append(block.content.cut(to)));
}

/** True when an autolink showing `shown` would have `link`'s target; `angle` for one in angle brackets. */
function namesItsTarget(link: Mark, shown: string, angle: boolean): boolean {
  if (link.attrs["identifier"] !== null || link.attrs["title"] !== null) return false;
  const href = link.attrs["href"] as string;
  return href === shown || href === "mailto:" + shown || (!angle && href === "http://" + shown);
}

/** True when `shown` in angle brackets is an autolink: a URL with a scheme, or an email address. */
function autolinkable(shown: string): boolean {
  return /^(?:[a-z][a-z\d+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>@]+)$/i.test(shown);
}

/**
 * The span of an inline link's destination, given the offset of the bracket that closes its text;
 * null when no `(` follows it.
 */
function destinationAt(text: string, closing: number): { start: number; end: number } | null {
  if (text[closing] !== "]" || text[closing + 1] !== "(") return null;
  const start = closing + 2 + /^[ \t]*(?:\r?\n[ \t>]*)?/.exec(text.slice(closing + 2))![0].length;
  let at = start;
  if (text[at] === "<") {
    for (at++; at < text.length && text[at] !== ">"; at++) {
      if (text[at] === "\\") at++;
      else if (text[at] === "\n" || text[at] === "<") return null;
    }
    return at < text.length ? { start, end: at + 1 } : null;
  }
  let depth = 0;
  for (; at < text.length; at++) {
    const c = text[at]!;
    if (c === "\\") at++;
    else if (c === "(") depth++;
    else if (c === ")" && depth-- === 0) break;
    else if (c <= " ") break;
  }
  return { start, end: at };
}

function withoutLink(marks: readonly Mark[]): readonly Mark[] {
  return marks.filter((m) => m.type !== schema.marks.link);
}
