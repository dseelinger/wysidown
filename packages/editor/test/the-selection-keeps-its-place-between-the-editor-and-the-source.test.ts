import { parseMarkdown, schema } from "@wysidown/core";
import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import { selectionAtSource, sourceSelectionOf } from "../src/source-selection.ts";
import { realisticCases } from "./support/corpus.ts";
import { Wire } from "./support/wire.ts";
import { wordEnd } from "./support/words.ts";

/** The text of `text` without its byte order mark, which source offsets do not count. */
const source = (text: string) => text.replace(/^\uFEFF/, "");

describe("the selection keeps its place between the editor and the source", () => {
  test.each(realisticCases())("the end of a word in $name maps to the same place in the source", ({ text }) => {
    const word = wordEnd(parseMarkdown(text))!;
    const wire = new Wire(text);
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, word.pos)));
    const bom = text.length - source(text).length;
    expect(sourceSelectionOf(wire.state, wire.session.text)).toEqual({
      anchor: word.offset - bom,
      head: word.offset - bom,
    });
  });

  test.each(realisticCases())("a selection made in the source of $name selects the same text", ({ text }) => {
    const word = wordEnd(parseMarkdown(text))!;
    const wire = new Wire(text);
    const bom = text.length - source(text).length;
    const end = word.offset - bom;
    const selected = selectionAtSource(wire.state, text, { anchor: end - 1, head: end })!;
    expect(selected.from).toBe(word.pos - 1);
    expect(selected.to).toBe(word.pos);
  });

  test("the selection after an edit maps into the edited text", () => {
    const wire = new Wire("One.\n\nTwo.\n");
    wire.edit((s) => s.tr.insert(10, schema.text("EDITED")));
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, 10, 16)));
    wire.drain();
    expect(wire.host.text).toBe("One.\n\nTwoEDITED.\n");
    expect(sourceSelectionOf(wire.state, wire.session.text)).toEqual({ anchor: 9, head: 15 });
  });

  test("a backward selection keeps its direction", () => {
    const text = "Some words here.\n";
    const state = EditorState.create({ doc: parseMarkdown(text).doc });
    const selected = selectionAtSource(state, text, { anchor: 10, head: 5 })!;
    expect([selected.anchor, selected.head]).toEqual([11, 6]);
  });

  test("an empty document maps to the start of its source", () => {
    const wire = new Wire("");
    expect(sourceSelectionOf(wire.state, wire.session.text)).toEqual({ anchor: 0, head: 0 });
    expect(selectionAtSource(wire.state, "", { anchor: 0, head: 0 })).toBeNull();
  });
});
