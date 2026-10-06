import { parseMarkdown, schema } from "@wysidown/core";
import { undo } from "prosemirror-history";
import { describe, expect, test } from "vitest";
import { realisticCases } from "./support/corpus.ts";
import { Wire } from "./support/wire.ts";
import { wordEnd } from "./support/words.ts";

describe("the host receives only the bytes an edit changed", () => {
  test.each(realisticCases())("loading $name sends no edit", ({ text }) => {
    const wire = new Wire(text);
    expect(wire.edits).toEqual([]);
    expect(wire.host.text).toBe(text);
  });

  test.each(realisticCases())("typing a word into $name inserts only that word", ({ text }) => {
    const word = wordEnd(parseMarkdown(text))!;
    const wire = new Wire(text);
    wire.edit((s) => s.tr.insert(word.pos, schema.text("EDITED", word.marks)));
    wire.drain();
    expect(wire.host.text).toBe(text.slice(0, word.offset) + "EDITED" + text.slice(word.offset));
    expect(wire.edits.map((e) => e.edits)).toEqual([[{ start: word.offset, end: word.offset, insert: "EDITED" }]]);
  });

  test.each(realisticCases())("undoing an edit to $name restores the host's original bytes", ({ text }) => {
    const word = wordEnd(parseMarkdown(text))!;
    const wire = new Wire(text);
    wire.edit((s) => s.tr.insert(word.pos, schema.text("EDITED", word.marks)));
    wire.drain();
    undo(wire.state, (tr) => {
      wire.session.update(wire.state.apply(tr));
    });
    wire.drain();
    expect(wire.host.text).toBe(text);
  });

  test("a load replaces the document and clears the undo history", () => {
    const wire = new Wire("One.\n");
    wire.edit((s) => s.tr.insertText("X", 4));
    wire.drain();
    wire.host.load("Two.\n");
    wire.drain();
    expect(wire.state.doc.eq(parseMarkdown("Two.\n").doc)).toBe(true);
    expect(undo(wire.state)).toBe(false);
  });
});
