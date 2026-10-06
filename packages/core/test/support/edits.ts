import type { Mark, Node } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import { parseMarkdown } from "../../src/markdown/parse.ts";
import { schema } from "../../src/markdown/schema.ts";
import { serializeMarkdown } from "../../src/markdown/serialize.ts";
import type { MarkdownSource } from "../../src/markdown/source.ts";
import {
  alignTableColumn,
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  type Alignment,
} from "../../src/markdown/tables.ts";
import { sameDocument } from "../../src/markdown/verify.ts";
import { writeBlocks } from "../../src/markdown/write.ts";

/**
 * What happened to one edit:
 * - `pass`: the output parses back to the edited document and only the expected bytes changed.
 * - `too-wide`: the output parses back to the edited document but more bytes changed than expected.
 * - `inherent`: no markdown text parses to the edited document (deleting a definition that other
 *   blocks refer to, for example), so no serializer could satisfy it.
 * - `serializer`: markdown can express the edit but the serializer did not.
 */
export type Outcome = "pass" | "too-wide" | "inherent" | "serializer";

export interface Case {
  label: string;
  outcome: Outcome;
  /** The edit, the edited document, the serializer's output and the source, for further checks. */
  transform: Transform;
  doc: Node;
  output: string;
  source: MarkdownSource;
}

export type EditKind =
  | "word"
  | "markdown characters"
  | "bold"
  | "insert"
  | "delete"
  | "toggle"
  | "new item"
  | "new row"
  | "delete row"
  | "new column"
  | "delete column"
  | "align"
  | "code word"
  | "code line"
  | "language"
  | "link target"
  | "add link"
  | "remove link";

/** Applies every edit of one kind to `input`, one at a time, and classifies each. */
export function editCases(input: string, kind: EditKind): Case[] {
  const source = parseMarkdown(input);
  const offset = source.bom ? 1 : 0;
  const cases: Case[] = [];
  const record = (transform: Transform, expected: (output: string) => boolean) => {
    const label = `${kind}#${cases.length + 1}`;
    const doc = transform.doc;
    const { text, verified } = serializeMarkdown(source, doc);
    const outcome: Outcome = verified
      ? expected(text)
        ? "pass"
        : "too-wide"
      : expressible(source, doc)
        ? "serializer"
        : "inherent";
    cases.push({ label, outcome, transform, doc, output: text, source });
  };
  const confinedTo = (start: number, end: number) => (output: string) =>
    output.slice(0, start + offset) === input.slice(0, start + offset) && output.endsWith(input.slice(end + offset));

  switch (kind) {
    case "word":
    case "markdown characters": {
      const replacement = kind === "word" ? "EDITED" : "a*b_[c]`d";
      for (const { node, pos } of textblocks(source.doc)) {
        const word = firstWord(node);
        const map = source.chars.get(node)!;
        if (!word || map.run[word.from]! < 0) continue;
        const transform = new Transform(source.doc).replaceWith(
          pos + 1 + word.from,
          pos + 1 + word.to,
          schema.text(replacement, word.marks),
        );
        const s = map.start[word.from]!;
        const e = map.end[word.to - 1]!;
        const block = source.ranges.get(node)!;
        record(
          transform,
          kind === "word"
            ? (output) => output === input.slice(0, s + offset) + replacement + input.slice(e + offset)
            : confinedTo(block.start, block.end),
        );
      }
      break;
    }
    case "bold":
      source.doc.forEach((block, pos) => {
        const targets: { from: number; to: number }[] = [];
        block.descendants((node, at) => {
          if (targets.length > 0 || !node.isText) return targets.length === 0;
          if (node.marks.some((m) => m.type.name === "code" || m.type.name === "strong")) return false;
          const m = /[A-Za-z]{3,}/.exec(node.text!);
          if (m) targets.push({ from: pos + 1 + at + m.index, to: pos + 1 + at + m.index + m[0].length });
          return false;
        });
        const target = targets[0];
        if (!target) return;
        const { from, to } = target;
        const r = source.ranges.get(block)!;
        record(new Transform(source.doc).addMark(from, to, schema.marks.strong.create()), confinedTo(r.start, r.end));
      });
      break;
    case "insert":
      source.doc.forEach((block, pos) => {
        const paragraph = schema.nodes.paragraph.create(null, schema.text("Inserted paragraph."));
        const end = source.ranges.get(block)!.end + offset;
        const rest = input.slice(end).replace(/^\s+/, "");
        record(
          new Transform(source.doc).insert(pos + block.nodeSize, paragraph),
          (output) => output.slice(0, end) === input.slice(0, end) && output.endsWith(rest),
        );
      });
      break;
    case "delete":
      if (source.doc.childCount < 2) break;
      source.doc.forEach((block, pos) => {
        const r = source.ranges.get(block)!;
        const before = input.slice(0, r.start + offset).replace(/\s+$/, "");
        const after = input.slice(r.end + offset).replace(/^\s+/, "");
        record(
          new Transform(source.doc).delete(pos, pos + block.nodeSize),
          (output) => output.startsWith(before) && output.endsWith(after),
        );
      });
      break;
    case "new item":
      source.doc.descendants((node, pos) => {
        if (node.type.name !== "list_item") return true;
        const checked = node.attrs["checked"] === null ? null : false;
        const paragraph = schema.nodes.paragraph.create(null, schema.text("New item"));
        const item = schema.nodes.list_item.create({ checked }, paragraph);
        const end = source.ranges.get(node)!.end + offset;
        record(
          new Transform(source.doc).insert(pos + node.nodeSize, item),
          (output) => output.slice(0, end) === input.slice(0, end) && output.endsWith(input.slice(end)),
        );
        return true;
      });
      break;
    case "toggle":
      source.doc.descendants((node, pos) => {
        if (node.type.name !== "list_item" || node.attrs["checked"] === null) return true;
        const attrs = { ...node.attrs, checked: !(node.attrs["checked"] as boolean) };
        record(new Transform(source.doc).setNodeMarkup(pos, null, attrs), (output) => {
          let differing = 0;
          for (let k = 0; k < input.length; k++) if (output[k] !== input[k]) differing++;
          return output.length === input.length && differing === 1;
        });
        return true;
      });
      break;
    case "new row":
      for (const { node, pos } of tables(source.doc)) {
        for (let k = 0; k < node.childCount; k++) {
          const row = source.ranges.get(node.child(k))!.end + offset;
          const end = lineEnd(input, k === 0 ? nextLine(input, row) : row);
          record(
            insertTableRow(new Transform(source.doc), pos, k + 1),
            (output) => output.slice(0, end) === input.slice(0, end) && output.endsWith(input.slice(end)),
          );
        }
      }
      break;
    case "delete row":
      for (const { node, pos } of tables(source.doc)) {
        for (let k = 1; k < node.childCount; k++) {
          const row = source.ranges.get(node.child(k))!;
          const from = input.lastIndexOf("\n", row.start + offset - 1) + 1;
          const to = nextLine(input, row.end + offset);
          const expected = input.slice(0, to).endsWith("\n")
            ? input.slice(0, from) + input.slice(to)
            : input.slice(0, from).replace(/\r?\n$/, "");
          record(deleteTableRow(new Transform(source.doc), pos, k), (output) => output === expected);
        }
      }
      break;
    case "new column":
    case "delete column":
      for (const { node, pos } of tables(source.doc)) {
        const columns = node.child(0).childCount;
        const r = source.ranges.get(node)!;
        for (let c = 0; c <= columns; c++) {
          if (kind === "new column") {
            record(insertTableColumn(new Transform(source.doc), pos, c), (output) =>
              linesChangedBy(input, output, r.start + offset, r.end + offset, (a, b) => oneStretchRemoved(a, b)),
            );
          } else if (c < columns && columns > 1) {
            record(deleteTableColumn(new Transform(source.doc), pos, c), (output) =>
              linesChangedBy(
                input,
                output,
                r.start + offset,
                r.end + offset,
                (a, b) => oneStretchRemoved(b, a) || emptyRow.test(b),
              ),
            );
          }
        }
      }
      break;
    case "align":
      for (const { node, pos } of tables(source.doc)) {
        const header = source.ranges.get(node.child(0))!.end + offset;
        const delimiter = nextLine(input, header);
        const cycle: Alignment[] = [null, "left", "center", "right"];
        (node.attrs["align"] as Alignment[]).forEach((a, c) => {
          const next = cycle[(cycle.indexOf(a) + 1) % cycle.length]!;
          record(alignTableColumn(new Transform(source.doc), pos, c, next), (output) =>
            linesChangedBy(input, output, delimiter, lineEnd(input, delimiter), () => true),
          );
        });
      }
      break;
    case "code word":
      for (const { node, pos } of codeBlocks(source.doc)) {
        const m = /[A-Za-z]{3,}/.exec(node.textContent);
        if (!m) continue;
        const from = pos + 1 + m.index;
        const r = source.ranges.get(node)!;
        record(new Transform(source.doc).replaceWith(from, from + m[0].length, schema.text("EDITED")), (output) =>
          wordReplaced(input, output, m[0], "EDITED", r.start + offset, r.end + offset),
        );
      }
      break;
    case "code line":
      for (const { node, pos } of codeBlocks(source.doc)) {
        const r = source.ranges.get(node)!;
        const line = node.textContent === "" ? "added line" : "\nadded line";
        record(
          new Transform(source.doc).insert(pos + 1 + node.content.size, schema.text(line)),
          (output) =>
            confinedTo(r.start, r.end)(output) &&
            (node.textContent === "" || oneLineAdded(input, output, "added line")),
        );
      }
      break;
    case "language":
      for (const { node, pos } of codeBlocks(source.doc)) {
        const r = source.ranges.get(node)!;
        const lang = node.attrs["lang"] === "text" ? "plain" : "text";
        const fenced = /^(`{3}|~{3})/.test(input.slice(r.start + offset));
        record(
          new Transform(source.doc).setNodeMarkup(pos, null, { ...node.attrs, lang }),
          fenced
            ? (output) => linesChangedBy(input, output, r.start + offset, r.start + offset + 1, () => true)
            : confinedTo(r.start, r.end),
        );
      }
      break;
    case "link target":
    case "remove link":
      for (const { node, pos } of textblocks(source.doc)) {
        for (const link of source.chars.get(node)?.links ?? []) {
          const mark = node
            .child(node.childBefore(link.from + 1).index)
            .marks.find((m) => m.type === schema.marks.link)!;
          const from = pos + 1 + link.from;
          const to = pos + 1 + link.to;
          const transform =
            kind === "remove link"
              ? new Transform(source.doc).removeMark(from, to, schema.marks.link)
              : new Transform(source.doc).addMark(
                  from,
                  to,
                  schema.marks.link.create({ href: linkHref, title: mark.attrs["title"] as string | null }),
                );
          record(transform, confinedTo(link.start, link.end));
        }
      }
      break;
    case "add link":
      for (const { node, pos } of textblocks(source.doc)) {
        const word = firstWord(node, (m) => m.type === schema.marks.link || m.type === schema.marks.code);
        const map = source.chars.get(node)!;
        if (!word || map.run[word.from]! < 0) continue;
        const s = map.start[word.from]! + offset;
        const e = map.end[word.to - 1]! + offset;
        record(
          new Transform(source.doc).addMark(
            pos + 1 + word.from,
            pos + 1 + word.to,
            schema.marks.link.create({ href: linkHref }),
          ),
          (output) => output === input.slice(0, s) + "[" + input.slice(s, e) + `](${linkHref})` + input.slice(e),
        );
      }
      break;
  }
  return cases;
}

/** The target the link edits give a link. */
const linkHref = "https://example.com/edited";

function codeBlocks(doc: Node): { node: Node; pos: number }[] {
  const out: { node: Node; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "code_block") out.push({ node, pos });
    return !node.isTextblock;
  });
  return out;
}

/** True when `output` is `input` with one occurrence of `word` inside `[from, to)` replaced by `by`. */
function wordReplaced(input: string, output: string, word: string, by: string, from: number, to: number): boolean {
  for (let at = input.indexOf(word, from); at >= 0 && at + word.length <= to; at = input.indexOf(word, at + 1)) {
    if (output === input.slice(0, at) + by + input.slice(at + word.length)) return true;
  }
  return false;
}

/** True when `output` is `input` with one line added that ends with `line`. */
function oneLineAdded(input: string, output: string, line: string): boolean {
  const a = input.split("\n");
  const b = output.split("\n");
  return b.some(
    (l, k) => l.replace(/\r$/, "").endsWith(line) && [...b.slice(0, k), ...b.slice(k + 1)].join("\n") === a.join("\n"),
  );
}

function tables(doc: Node): { node: Node; pos: number }[] {
  const out: { node: Node; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "table") out.push({ node, pos });
    return !node.isTextblock && node.type.name !== "table";
  });
  return out;
}

/** The offset just after the line ending at or after `offset`, or the end of `text`. */
function nextLine(text: string, offset: number): number {
  const nl = text.indexOf("\n", offset);
  return nl < 0 ? text.length : nl + 1;
}

/** The offset of the line ending at or after `offset`, or the end of `text`. */
function lineEnd(text: string, offset: number): number {
  const nl = text.indexOf("\n", offset);
  if (nl < 0) return text.length;
  return text[nl - 1] === "\r" ? nl - 1 : nl;
}

/** A table row holding one empty cell: what a row whose only cell was deleted becomes. */
const emptyRow = /^[ \t>]*\|[ \t]*\|[ \t]*\r?$/;

/** True when `small` is `large` with one stretch of characters taken out. */
function oneStretchRemoved(small: string, large: string): boolean {
  let pre = 0;
  while (pre < small.length && small[pre] === large[pre]) pre++;
  return large.length > small.length && large.endsWith(small.slice(pre));
}

/**
 * True when `output` has as many lines as `input`, each the same as the input line or, for the
 * lines that touch `[from, to)`, related to it by `changed(inputLine, outputLine)`.
 */
function linesChangedBy(
  input: string,
  output: string,
  from: number,
  to: number,
  changed: (a: string, b: string) => boolean,
): boolean {
  const a = input.split("\n");
  const b = output.split("\n");
  if (a.length !== b.length) return false;
  let start = 0;
  return a.every((line, k) => {
    const lineStart = start;
    start += line.length + 1;
    return line === b[k] || (lineStart + line.length >= from && lineStart < to && changed(line, b[k]!));
  });
}

/** True when writing the whole document from scratch parses back to it. */
function expressible(source: MarkdownSource, doc: Node): boolean {
  const children: Node[] = [];
  doc.forEach((c) => children.push(c));
  try {
    return sameDocument(parseMarkdown(writeBlocks(children, source.style)).doc, doc);
  } catch {
    return false;
  }
}

function textblocks(doc: Node): { node: Node; pos: number }[] {
  const out: { node: Node; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && node.type.name !== "code_block") out.push({ node, pos });
    return !node.isTextblock;
  });
  return out;
}

/** The first word of three or more letters in a textblock, as content offsets, outside any mark `skip` names. */
function firstWord(
  block: Node,
  skip: (mark: Mark) => boolean = () => false,
): { from: number; to: number; marks: readonly Mark[] } | null {
  let offset = 0;
  let found: { from: number; to: number; marks: readonly Mark[] } | null = null;
  block.forEach((child) => {
    if (!found && child.isText && !child.marks.some(skip)) {
      const m = /[A-Za-z]{3,}/.exec(child.text!);
      if (m) found = { from: offset + m.index, to: offset + m.index + m[0].length, marks: child.marks };
    }
    offset += child.nodeSize;
  });
  return found;
}
