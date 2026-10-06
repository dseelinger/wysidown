import type { Mark, Node } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import { parseMarkdown } from "../../src/markdown/parse.ts";
import { schema } from "../../src/markdown/schema.ts";
import { serializeMarkdown } from "../../src/markdown/serialize.ts";
import type { MarkdownSource } from "../../src/markdown/source.ts";
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

export type EditKind = "word" | "markdown characters" | "bold" | "insert" | "delete" | "toggle";

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
  }
  return cases;
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

/** The first word of three or more letters in a textblock, as content offsets. */
function firstWord(block: Node): { from: number; to: number; marks: readonly Mark[] } | null {
  let offset = 0;
  let found: { from: number; to: number; marks: readonly Mark[] } | null = null;
  block.forEach((child) => {
    if (!found && child.isText) {
      const m = /[A-Za-z]{3,}/.exec(child.text!);
      if (m) found = { from: offset + m.index, to: offset + m.index + m[0].length, marks: child.marks };
    }
    offset += child.nodeSize;
  });
  return found;
}
