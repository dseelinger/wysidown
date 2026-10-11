import type { Node } from "prosemirror-model";
import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../src/markdown/parse.ts";

/** The `spread` attribute of every list in `text`, in document order. */
function spreads(text: string): boolean[] {
  const out: boolean[] = [];
  parseMarkdown(text).doc.descendants((node: Node) => {
    if (node.type.name === "list") out.push(node.attrs["spread"] as boolean);
  });
  return out;
}

const endings = [
  ["LF", "\n"],
  ["CRLF", "\r\n"],
  ["CR", "\r"],
] as const;

describe.each(endings)("a list is loose only when a blank line separates its items, with %s", (_, eol) => {
  const lines = (...ls: string[]) => ls.join(eol) + eol;

  test("a list in a quote followed by a blank quote line is tight", () => {
    expect(spreads(lines("> - one", "> - two", ">", "> > A nested quote."))).toEqual([false]);
    expect(spreads(lines("> - one", "> - two", ">", "> After."))).toEqual([false]);
  });

  test("a list in a quote before a list of the other kind is tight, and so is that list", () => {
    expect(spreads(lines("> 1. A", ">", "> - one", "> - two"))).toEqual([false, false]);
  });

  test("a list in a quote with a blank line between its items is loose", () => {
    expect(spreads(lines("> - one", ">", "> - two"))).toEqual([true]);
    expect(spreads(lines("> - one", ">", "> - two", ">", "> After."))).toEqual([true]);
  });

  test("a top-level list is loose with a blank line between its items and tight without", () => {
    expect(spreads(lines("- one", "", "- two"))).toEqual([true]);
    expect(spreads(lines("- one", "- two", "", "After."))).toEqual([false]);
  });
});
