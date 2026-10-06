import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../src/markdown/parse.ts";
import { schema } from "../src/markdown/schema.ts";
import { serializeMarkdown } from "../src/markdown/serialize.ts";

const hello = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text("Hello")));

describe("a document with no blocks saves from and to nothing", () => {
  test.each([
    ["an empty file", "", "Hello"],
    ["a file of blank lines", "\n\n", "Hello\n\n"],
    ["a CRLF file of blank lines", "\r\n\r\n", "Hello\r\n\r\n"],
    ["an empty file with a byte order mark", "﻿", "﻿Hello"],
  ])("a paragraph added to %s is written ahead of the blank lines, which are kept", (_name, text, expected) => {
    expect(serializeMarkdown(parseMarkdown(text), hello)).toEqual({ text: expected, verified: true, step: "minimal" });
  });

  test("a paragraph and a heading added to an empty CRLF file use CRLF", () => {
    const source = parseMarkdown("\r\n");
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.heading.create({ level: 1 }, schema.text("Title")),
      schema.nodes.paragraph.create(null, schema.text("Words.")),
    ]);
    expect(serializeMarkdown(source, doc).text).toBe("# Title\r\n\r\nWords.\r\n");
  });

  test("deleting every block writes an empty file", () => {
    const source = parseMarkdown("# Title\n\nSome words.\n");
    expect(serializeMarkdown(source, schema.nodes.doc.create())).toEqual({ text: "", verified: true, step: "minimal" });
  });
});
