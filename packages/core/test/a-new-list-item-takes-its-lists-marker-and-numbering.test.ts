import type { Node } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../src/markdown/parse.ts";
import { schema } from "../src/markdown/schema.ts";
import { serializeMarkdown } from "../src/markdown/serialize.ts";

/** Saves `input` with a new item holding `paragraphs` inserted at `index` of its first list. */
function withNewItem(input: string, index: number, paragraphs = ["New"], checked: boolean | null = null): string {
  const source = parseMarkdown(input);
  let list: { node: Node; pos: number } | null = null;
  source.doc.descendants((node, pos) => {
    list ??= node.type.name === "list" ? { node, pos } : null;
    return list === null;
  });
  const { node, pos } = list!;
  let at = pos + 1;
  for (let k = 0; k < index; k++) at += node.child(k).nodeSize;
  const content = paragraphs.map((p) => schema.nodes.paragraph.create(null, schema.text(p)));
  const item = schema.nodes.list_item.create({ checked, spread: paragraphs.length > 1 }, content);
  const result = serializeMarkdown(source, new Transform(source.doc).insert(at, item).doc);
  expect(result.verified).toBe(true);
  return result.text;
}

describe("a new list item takes its list's marker and numbering", () => {
  test("an asterisk list gets an asterisk in a document that mostly uses dashes", () => {
    expect(withNewItem("* one\n* two\n\ntext\n\n- a\n\ntext\n\n- b\n", 1)).toBe(
      "* one\n* New\n* two\n\ntext\n\n- a\n\ntext\n\n- b\n",
    );
  });

  test("a plus list gets a plus", () => {
    expect(withNewItem("+ one\n+ two\n", 2)).toBe("+ one\n+ two\n+ New\n");
  });

  test("a sequential list continues the number before it", () => {
    expect(withNewItem("1. one\n2. two\n3. three\n", 2)).toBe("1. one\n2. two\n3. New\n3. three\n");
  });

  test("a list numbered all ones gets a one", () => {
    expect(withNewItem("1. one\n1. two\n1. three\n", 3)).toBe("1. one\n1. two\n1. three\n1. New\n");
  });

  test("a list with a parenthesis delimiter gets a parenthesis", () => {
    expect(withNewItem("1) one\n2) two\n", 2)).toBe("1) one\n2) two\n3) New\n");
  });

  test("a zero-padded list gets a zero-padded number", () => {
    expect(withNewItem("01. first\n02. second\n", 2)).toBe("01. first\n02. second\n03. New\n");
  });

  test("a new first item takes the list's start number", () => {
    expect(withNewItem("5. five\n6. six\n", 0)).toBe("5. New\n5. five\n6. six\n");
  });

  test("the spacing after the marker is copied, and continuation lines line up with it", () => {
    expect(withNewItem("-   one\n-   two\n", 2, ["New", "Second"])).toBe("-   one\n-   two\n-   New\n\n    Second\n");
  });

  test("a new task item gets an unchecked box after the list's marker", () => {
    expect(withNewItem("* [x] done\n* [ ] todo\n", 2, ["New"], false)).toBe("* [x] done\n* [ ] todo\n* [ ] New\n");
  });

  test("an item added to a loose list is separated by a blank line", () => {
    expect(withNewItem("- one\n\n- two\n", 1)).toBe("- one\n\n- New\n\n- two\n");
  });

  test("an item added to a nested list lines up with its siblings", () => {
    expect(withNewItem("1. top\n   - a\n   - b\n2. next\n", 0)).toBe("1. New\n1. top\n   - a\n   - b\n2. next\n");
    const source = parseMarkdown("1. top\n   - a\n   - b\n2. next\n");
    const inner = source.doc.child(0).child(0).child(1);
    const item = schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text("New")));
    const at = 1 + 1 + source.doc.child(0).child(0).child(0).nodeSize + 1 + inner.child(0).nodeSize;
    const result = serializeMarkdown(source, new Transform(source.doc).insert(at, item).doc);
    expect(result).toMatchObject({ verified: true, text: "1. top\n   - a\n   - New\n   - b\n2. next\n" });
  });
});
