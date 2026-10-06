import { parseMarkdown, schema } from "@wysidown/core";
import { TextSelection } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import { realisticCases } from "./support/corpus.ts";
import { Wire } from "./support/wire.ts";
import { wordEnd } from "./support/words.ts";

/** `text` with "Changed. " at the start of its first top-level paragraph, and that paragraph's index. */
function changeFirstParagraph(text: string): { text: string; block: number } | null {
  const source = parseMarkdown(text);
  let found: { text: string; block: number } | null = null;
  source.doc.forEach((node, _, block) => {
    if (found || node.type.name !== "paragraph") return;
    const at = source.ranges.get(node)!.start + (source.bom ? 1 : 0);
    found = { text: text.slice(0, at) + "Changed. " + text.slice(at), block };
  });
  return found;
}

const withParagraph = realisticCases().filter((c) => changeFirstParagraph(c.text) !== null);

describe("an external change replaces only the blocks it changed", () => {
  test.each(withParagraph)("changing one paragraph of $name keeps every other block", ({ text }) => {
    const change = changeFirstParagraph(text)!;
    const wire = new Wire(text);
    const before = wire.state.doc;
    wire.host.change(change.text);
    wire.drain();
    const after = wire.state.doc;
    expect(after.eq(parseMarkdown(change.text).doc)).toBe(true);
    expect(after.childCount).toBe(before.childCount);
    const replaced: number[] = [];
    after.forEach((node, _, k) => {
      if (node !== before.child(k)) replaced.push(k);
    });
    expect(replaced).toEqual([change.block]);
    expect(wire.edits).toEqual([]);
  });

  test.each(withParagraph)("an edit to $name after an external change inserts only its own bytes", ({ text }) => {
    const change = changeFirstParagraph(text)!;
    const word = wordEnd(parseMarkdown(change.text), change.block);
    if (!word) return;
    const wire = new Wire(text);
    wire.host.change(change.text);
    wire.drain();
    wire.edit((s) => s.tr.insert(word.pos, schema.text("EDITED", word.marks)));
    wire.drain();
    expect(wire.host.text).toBe(change.text.slice(0, word.offset) + "EDITED" + change.text.slice(word.offset));
  });

  test("a change that only restyles markup keeps the document and saves the new bytes", () => {
    const wire = new Wire("Some *stress* here.\n\nOther text.\n");
    const before = wire.state.doc;
    wire.host.change("Some _stress_ here.\n\nOther text.\n");
    wire.drain();
    expect(wire.state.doc).toBe(before);
    wire.edit((s) => s.tr.insertText("!", s.doc.content.size - 1));
    wire.drain();
    expect(wire.host.text).toBe("Some _stress_ here.\n\nOther text.!\n");
  });

  test("a cursor in an unchanged block stays where it was", () => {
    const wire = new Wire("First.\n\nSecond.\n\nThird.\n");
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, 20)));
    wire.host.change("First, changed.\n\nSecond.\n\nThird.\n");
    wire.drain();
    const { $head } = wire.state.selection;
    expect($head.parent.textContent).toBe("Third.");
    expect($head.parentOffset).toBe(2);
  });
});
