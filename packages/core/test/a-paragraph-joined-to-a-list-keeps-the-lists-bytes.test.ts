import type { Node } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import { describe, expect, test } from "vitest";
import { byteOrderMark } from "../src/text/byte-order-mark.ts";
import { parseMarkdown } from "../src/markdown/parse.ts";
import { schema } from "../src/markdown/schema.ts";
import { serializeMarkdown } from "../src/markdown/serialize.ts";

const { list, list_item: item } = schema.nodes;

/**
 * Makes the paragraph that starts with `find` an item of a new list, joined to a list of the same
 * kind straight before or after it, as typing a list marker at its start does in the editor.
 */
function join(doc: Node, find: string, ordered: boolean, start: number | null): Transform {
  let pos = -1;
  doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === "paragraph" && node.textContent.startsWith(find)) pos = p;
    return pos < 0;
  });
  const tr = new Transform(doc);
  const range = tr.doc.resolve(pos + 1).blockRange()!;
  tr.wrap(range, [
    { type: list, attrs: { ordered, start } },
    { type: item, attrs: null },
  ]);
  const sameKind = (node: Node | null | undefined) => node?.type === list && node.attrs["ordered"] === ordered;
  const at = range.start;
  const end = at + tr.doc.nodeAt(at)!.nodeSize;
  const after = tr.doc.resolve(end).nodeAfter;
  if (sameKind(after)) tr.join(end).setNodeMarkup(at, null, { ...after!.attrs, start });
  if (sameKind(tr.doc.resolve(at).nodeBefore)) tr.join(at);
  return tr;
}

/** The items of every list in `doc` that do not hold `find`. */
function items(doc: Node, find: string): Node[] {
  const out: Node[] = [];
  doc.descendants((node) => {
    if (node.type === item && !node.textContent.includes(find)) out.push(node);
    return true;
  });
  return out;
}

/** Saves `input` with the paragraph starting `find` joined to the list beside it. */
function saved(input: string, find: string, ordered = false, start: number | null = null): string {
  const source = parseMarkdown(input);
  const doc = join(source.doc, find, ordered, start).doc;
  const kept = new Set(items(doc, find));
  expect(items(source.doc, find).every((original) => kept.has(original))).toBe(true);
  const result = serializeMarkdown(source, doc);
  expect(result.verified).toBe(true);
  return result.text;
}

const cases: { name: string; input: string; find: string; ordered?: boolean; start?: number; output: string }[] = [
  {
    name: "a tight bullet list after",
    input: "- one\n- two\n\nOutro.\n",
    find: "Outro",
    output: "- one\n- two\n- Outro.\n",
  },
  {
    name: "a tight bullet list before",
    input: "Intro:\n\n- one\n- two\n",
    find: "Intro",
    output: "- Intro:\n- one\n- two\n",
  },
  {
    name: "a loose bullet list after",
    input: "- one\n\n- two\n\nOutro.\n",
    find: "Outro",
    output: "- one\n\n- two\n\n- Outro.\n",
  },
  {
    name: "a loose bullet list before",
    input: "Intro:\n\n- one\n\n- two\n",
    find: "Intro",
    output: "- Intro:\n\n- one\n\n- two\n",
  },
  {
    name: "a numbered list after",
    input: "1. one\n2. two\n\nOutro.\n",
    find: "Outro",
    ordered: true,
    start: 1,
    output: "1. one\n2. two\n3. Outro.\n",
  },
  {
    name: "a numbered list before, which keeps its own numbers",
    input: "Intro:\n\n1. one\n2. two\n",
    find: "Intro",
    ordered: true,
    start: 1,
    output: "1. Intro:\n1. one\n2. two\n",
  },
  {
    name: "a numbered list before, starting at another number than was typed",
    input: "Intro:\n\n3. three\n4. four\n",
    find: "Intro",
    ordered: true,
    start: 1,
    output: "1. Intro:\n3. three\n4. four\n",
  },
  {
    name: "a numbered list with a parenthesis delimiter",
    input: "1) one\n2) two\n\nOutro.\n",
    find: "Outro",
    ordered: true,
    start: 1,
    output: "1) one\n2) two\n3) Outro.\n",
  },
  {
    name: "a list with tabs after its markers",
    input: "-\tone\n-\ttwo\n\nOutro.\n",
    find: "Outro",
    output: "-\tone\n-\ttwo\n- Outro.\n",
  },
  {
    name: "a list with a marker other than the document's usual one",
    input: "- a\n- b\n- c\n\nText.\n\nIntro:\n\n* one\n* two\n",
    find: "Intro",
    output: "- a\n- b\n- c\n\nText.\n\n* Intro:\n* one\n* two\n",
  },
  {
    name: "a list on each side",
    input: "- one\n\nMiddle\n\n-   two\n-   three\n\nOutro.\n",
    find: "Middle",
    output: "- one\n- Middle\n-   two\n-   three\n\nOutro.\n",
  },
  {
    name: "a list in a blockquote",
    input: "> Intro:\n>\n> - one\n> - two\n",
    find: "Intro",
    output: "> - Intro:\n> - one\n> - two\n",
  },
  {
    name: "a list in a list item",
    input: "- item\n\n  Intro:\n\n  * one\n  * two\n- next\n",
    find: "Intro",
    output: "- item\n\n  * Intro:\n  * one\n  * two\n- next\n",
  },
];

const forms: { name: string; form: (text: string) => string }[] = [
  { name: "LF", form: (text) => text },
  { name: "CRLF", form: (text) => text.replace(/\n/g, "\r\n") },
  { name: "BOM", form: (text) => byteOrderMark + text },
];

describe("a paragraph joined to a list keeps the list's own bytes", () => {
  for (const { name, form } of forms) {
    test.each(cases)(`$name (${name})`, ({ input, find, ordered, start, output }) => {
      expect(saved(form(input), find, ordered, start ?? null)).toBe(form(output));
    });
  }

  test("two lists with different bullets joined into one are written with one bullet", () => {
    expect(saved("- one\n\nMiddle\n\n* two\n* three\n", "Middle")).toBe("- one\n- Middle\n- two\n- three\n");
  });
});
