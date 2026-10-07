import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../src/markdown/parse.ts";
import { positionAt, sourceOffsetAt } from "../src/markdown/positions.ts";
import type { MarkdownSource } from "../src/markdown/source.ts";
import { realisticCases } from "./support/corpus.ts";

interface Character {
  pos: number;
  char: string;
}

/** Every position before a character of a textblock whose source span is that one character alone. */
function plainCharacters(source: MarkdownSource): Character[] {
  const out: Character[] = [];
  source.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const chars = source.chars.get(node);
    node.forEach((child, offset) => {
      if (!child.isText) return;
      const value = child.text!;
      for (let i = 0; i < value.length; i++) {
        const k = offset + i;
        const plain = chars ? chars.start[k]! >= 0 && chars.end[k] === chars.start[k]! + 1 : value[i] !== "\n";
        if (plain) out.push({ pos: pos + 1 + k, char: value[i]! });
      }
    });
    return false;
  });
  return out;
}

describe("a position maps to its source offset and back", () => {
  test.each(realisticCases())("each character of $name maps to the same character in the source", ({ text }) => {
    const source = parseMarkdown(text);
    for (const { pos, char } of plainCharacters(source)) {
      const offset = sourceOffsetAt(source, pos);
      expect({ pos, char: source.text[offset] }).toEqual({ pos, char });
      expect(positionAt(source, offset)).toBe(pos);
    }
  });

  test.each(realisticCases())("every offset of $name maps to a position in text or before a block", ({ text }) => {
    const source = parseMarkdown(text);
    for (let offset = 0; offset <= source.text.length; offset++) {
      const $pos = source.doc.resolve(positionAt(source, offset));
      expect($pos.parent.isTextblock || $pos.nodeAfter?.isAtom === true).toBe(true);
    }
  });

  test("an offset in a heading's marker maps to the start of its text", () => {
    const source = parseMarkdown("Intro\n\n## Title\n");
    const pos = positionAt(source, source.text.indexOf("##"));
    expect(source.doc.resolve(pos).parent.type.name).toBe("heading");
    expect(source.doc.resolve(pos).parentOffset).toBe(0);
  });

  test("an offset in a code block's fence maps to the start of its code", () => {
    const source = parseMarkdown("Intro\n\n```js\nlet x;\n```\n");
    const $pos = source.doc.resolve(positionAt(source, source.text.indexOf("```js") + 2));
    expect($pos.parent.type.name).toBe("code_block");
    expect($pos.parentOffset).toBe(0);
  });

  test("a code line with CRLF endings maps past the carriage return", () => {
    const source = parseMarkdown("```\r\none\r\ntwo\r\n```\r\n");
    const code = source.doc.firstChild!;
    expect(sourceOffsetAt(source, 1 + code.textContent.indexOf("two"))).toBe(source.text.indexOf("two"));
    expect(positionAt(source, source.text.indexOf("two"))).toBe(1 + code.textContent.indexOf("two"));
  });

  test("the end of a paragraph maps to the end of its text, before the line break", () => {
    const source = parseMarkdown("One\n\nTwo\n");
    expect(sourceOffsetAt(source, 4)).toBe(3);
    expect(positionAt(source, 3)).toBe(4);
  });

  test("an offset past the last block maps to the end of the last text", () => {
    const source = parseMarkdown("One\n\n\n");
    expect(positionAt(source, source.text.length)).toBe(4);
  });

  test("a position between blocks maps to the start of the block after it", () => {
    const source = parseMarkdown("One\n\n---\n");
    expect(sourceOffsetAt(source, 5)).toBe(source.text.indexOf("---"));
    expect(positionAt(source, source.text.indexOf("---"))).toBe(5);
  });
});
