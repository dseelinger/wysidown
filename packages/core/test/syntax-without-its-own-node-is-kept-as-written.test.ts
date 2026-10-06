import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../src/markdown/parse.ts";

function rawNodes(text: string): { type: string; kind?: string; source: string }[] {
  const out: { type: string; kind?: string; source: string }[] = [];
  parseMarkdown(text).doc.descendants((node) => {
    if (node.type.name === "raw_block") {
      out.push({ type: "raw_block", kind: node.attrs["kind"] as string, source: node.attrs["source"] as string });
    } else if (node.type.name === "raw_inline") {
      out.push({ type: "raw_inline", source: node.attrs["source"] as string });
    }
    return true;
  });
  return out;
}

describe("syntax without its own node is kept as written", () => {
  test.each([
    [
      "front matter",
      "---\ntitle: x\n---\n\nText.\n",
      { type: "raw_block", kind: "yaml", source: "---\ntitle: x\n---" },
    ],
    [
      "an HTML block",
      "<details>\n<summary>S</summary>\n</details>\n",
      { type: "raw_block", kind: "html", source: "<details>\n<summary>S</summary>\n</details>" },
    ],
    [
      "a link definition",
      "[a]: https://example.com 'T'\n",
      { type: "raw_block", kind: "definition", source: "[a]: https://example.com 'T'" },
    ],
    [
      "a footnote definition",
      "Text.[^1]\n\n[^1]: Note.\n",
      { type: "raw_block", kind: "footnoteDefinition", source: "[^1]: Note." },
    ],
    ["display math", "$$\nx^2\n$$\n", { type: "raw_block", kind: "math", source: "$$\nx^2\n$$" }],
  ])("%s becomes a raw block holding its source", (_name, text, expected) => {
    expect(rawNodes(text)).toContainEqual(expected);
  });

  test.each([
    ["inline HTML", "Press <kbd>Ctrl</kbd>.\n", "<kbd>"],
    ["a footnote reference", "Text.[^1]\n\n[^1]: Note.\n", "[^1]"],
    ["inline math", "Euler: $e^{i\\pi}$.\n", "$e^{i\\pi}$"],
  ])("%s becomes a raw inline node holding its source", (_name, text, source) => {
    expect(rawNodes(text)).toContainEqual({ type: "raw_inline", source });
  });
});
