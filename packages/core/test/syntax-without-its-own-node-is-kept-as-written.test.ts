import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../src/markdown/parse.ts";

interface Raw {
  type: string;
  kind?: string;
  source: string;
  identifier: string | null;
}

function rawNodes(text: string): Raw[] {
  const out: Raw[] = [];
  parseMarkdown(text).doc.descendants((node) => {
    const source = node.attrs["source"] as string;
    const identifier = node.attrs["identifier"] as string | null;
    if (node.type.name === "raw_block") {
      out.push({ type: "raw_block", kind: node.attrs["kind"] as string, source, identifier });
    } else if (node.type.name === "raw_inline") {
      out.push({ type: "raw_inline", source, identifier });
    }
    return true;
  });
  return out;
}

function nodeTypes(text: string): string[] {
  const out: string[] = [];
  parseMarkdown(text).doc.descendants((node) => {
    out.push(node.type.name);
    return !node.isTextblock;
  });
  return out;
}

describe("syntax without its own node is kept as written", () => {
  test.each([
    [
      "front matter",
      "---\ntitle: x\n---\n\nText.\n",
      { type: "raw_block", kind: "yaml", source: "---\ntitle: x\n---", identifier: null },
    ],
    [
      "an HTML block",
      "<details>\n<summary>S</summary>\n</details>\n",
      { type: "raw_block", kind: "html", source: "<details>\n<summary>S</summary>\n</details>", identifier: null },
    ],
    [
      "a link definition",
      "[A]: https://example.com 'T'\n",
      { type: "raw_block", kind: "definition", source: "[A]: https://example.com 'T'", identifier: "a" },
    ],
    [
      "a footnote definition",
      "Text.[^1]\n\n[^1]: Note.\n",
      { type: "raw_block", kind: "footnoteDefinition", source: "[^1]: Note.", identifier: "1" },
    ],
    ["display math", "$$\nx^2\n$$\n", { type: "raw_block", kind: "math", source: "$$\nx^2\n$$", identifier: null }],
    [
      "an alert",
      "> [!WARNING]\n> Back up first.\n",
      { type: "raw_block", kind: "alert", source: "> [!WARNING]\n> Back up first.", identifier: null },
    ],
    [
      "an alert written in lower case",
      "> [!tip]  \r\n> Try this.\r\n",
      { type: "raw_block", kind: "alert", source: "> [!tip]  \r\n> Try this.", identifier: null },
    ],
  ])("%s becomes a raw block holding its source", (_name, text, expected) => {
    expect(rawNodes(text)).toContainEqual(expected);
  });

  test.each([
    ["inline HTML", "Press <kbd>Ctrl</kbd>.\n", "<kbd>", null],
    ["a footnote reference", "Text.[^1]\n\n[^1]: Note.\n", "[^1]", "1"],
    ["an image reference", "See ![logo][L].\n\n[l]: ./logo.png\n", "![logo][L]", "l"],
    ["inline math", "Euler: $e^{i\\pi}$.\n", "$e^{i\\pi}$", null],
  ])("%s becomes a raw inline node holding its source", (_name, text, source, identifier) => {
    expect(rawNodes(text)).toContainEqual({ type: "raw_inline", source, identifier });
  });

  test.each([
    ["a quote", "> A quote.\n"],
    ["an unknown alert type", "> [!DANGER]\n> Text.\n"],
    ["an alert marker with text after it on its line", "> [!NOTE] Text.\n"],
    ["an escaped alert marker", "> \\[!NOTE]\n> Text.\n"],
  ])("%s stays an editable blockquote", (_name, text) => {
    expect(nodeTypes(text)).toEqual(["blockquote", "paragraph"]);
  });

  test("an alert holding a link definition stays an editable blockquote", () => {
    expect(nodeTypes("See [a].\n\n> [!NOTE]\n> Text.\n>\n> [a]: https://example.com\n")).toEqual([
      "paragraph",
      "blockquote",
      "paragraph",
      "raw_block",
    ]);
  });

  test("an alert inside a list stays an editable blockquote", () => {
    expect(nodeTypes("- > [!NOTE]\n  > Text.\n")).toEqual(["list", "list_item", "blockquote", "paragraph"]);
  });
});
