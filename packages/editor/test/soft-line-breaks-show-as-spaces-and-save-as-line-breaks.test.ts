import type { Node } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import type { DecorationSet } from "prosemirror-view";
import { describe, expect, test } from "vitest";
import { softBreaks } from "../src/soft-breaks.ts";
import { fixture } from "./support/corpus.ts";
import { Wire } from "./support/wire.ts";

/** The document position of the first occurrence of `needle` inside one text node. */
function at(doc: Node, needle: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    const i = node.text?.indexOf(needle) ?? -1;
    if (i >= 0) found = pos + i;
    return true;
  });
  if (found < 0) throw new Error(`"${needle}" is not in one text node`);
  return found;
}

/** The text each soft-break decoration covers, and the text of the block around it. */
function marked(state: EditorState): [string, string][] {
  const plugin = softBreaks();
  const set = plugin.props.decorations?.call(plugin, state) as DecorationSet;
  return set.find().map((d) => [state.doc.textBetween(d.from, d.to), state.doc.resolve(d.from).parent.textContent]);
}

const blog = fixture("27-blog-post.md");

describe("soft line breaks show as spaces and save as line breaks", () => {
  test("each soft line break in paragraphs, headings and list items is marked, and nothing else", () => {
    const state = new Wire(
      "One\ntwo  \nthree\\\nfour\n\nSetext\nheading\n===\n\n- item\n  wrapped\n\n```\ncode\nlines\n```\n\n| a |\n| - |\n| b |\n",
    ).state;
    expect(marked(state)).toEqual([
      ["\n", "One\ntwothreefour"],
      ["\n", "Setext\nheading"],
      ["\n", "item\nwrapped"],
    ]);
  });

  test("a word replaced in the middle line of a wrapped paragraph changes only that word's bytes", () => {
    const wire = new Wire(blog);
    const from = at(wire.state.doc, "typo");
    wire.edit((s) => s.tr.insertText("spelling mistake", from, from + "typo".length));
    wire.drain();
    expect(wire.host.text).toBe(blog.replace("fix a typo,", "fix a spelling mistake,"));
    expect(wire.edits.map((e) => e.edits)).toEqual([
      [{ start: blog.indexOf("typo"), end: blog.indexOf("typo") + 4, insert: "spelling mistake" }],
    ]);
  });

  test("text typed on either side of a soft line break stays on that side", () => {
    const wire = new Wire(blog);
    const lineBreak = at(wire.state.doc, "\nfix a typo");
    wire.edit((s) => s.tr.insertText(" Then", lineBreak).insertText("Now ", lineBreak + " Then\n".length));
    wire.drain();
    expect(wire.host.text).toBe(blog.replace("Open a document,\nfix", "Open a document, Then\nNow fix"));
  });

  test("deleting a soft line break joins the two lines", () => {
    const wire = new Wire(blog);
    const lineBreak = at(wire.state.doc, "\nfix a typo");
    wire.edit((s) => s.tr.delete(lineBreak, lineBreak + 1));
    wire.drain();
    expect(wire.host.text).toBe(blog.replace("Open a document,\nfix", "Open a document,fix"));
  });
});
