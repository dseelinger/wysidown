import type { Node } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import { Wire } from "./support/wire.ts";

/** The position of the `index`th top-level block of the document. */
function blockAt(doc: Node, index: number): { from: number; to: number } {
  let from = 0;
  for (let k = 0; k < index; k++) from += doc.child(k).nodeSize;
  return { from, to: from + doc.child(index).nodeSize };
}

const deleteBlock = (index: number) => (s: EditorState) => {
  const { from, to } = blockAt(s.doc, index);
  return s.tr.delete(from, to);
};

describe("a definition that text refers to cannot be deleted", () => {
  test.each([
    ["a link definition", "See [the docs][d].\n\n[d]: https://example.com\n"],
    ["a link definition with a differently cased label", "See [docs].\n\n[Docs]: https://example.com\n"],
    ["a footnote definition", "Text.[^1]\n\n[^1]: A note.\n"],
    ["an image definition", "See ![logo][l].\n\n[l]: ./logo.png\n"],
  ])("deleting %s that text refers to leaves the file unchanged", (_name, text) => {
    const wire = new Wire(text);
    wire.edit(deleteBlock(1));
    wire.drain();
    expect(wire.state.doc.childCount).toBe(2);
    expect(wire.edits).toEqual([]);
    expect(wire.host.text).toBe(text);
  });

  test("deleting a definition nothing refers to removes it", () => {
    const wire = new Wire("Text.\n\n[d]: https://example.com\n");
    wire.edit(deleteBlock(1));
    wire.drain();
    expect(wire.host.text).toBe("Text.\n");
  });

  test("deleting a definition together with the text that refers to it removes both", () => {
    const wire = new Wire("Intro.\n\nSee [docs].\n\n[docs]: https://example.com\n");
    wire.edit((s) => s.tr.delete(blockAt(s.doc, 1).from, blockAt(s.doc, 2).to));
    wire.drain();
    expect(wire.host.text).toBe("Intro.\n");
  });

  test("deleting one of two definitions with the same label removes it", () => {
    const wire = new Wire("See [docs].\n\n[docs]: https://a.example\n\n[docs]: https://b.example\n");
    wire.edit(deleteBlock(2));
    wire.drain();
    expect(wire.host.text).toBe("See [docs].\n\n[docs]: https://a.example\n");
  });

  test("an external change that removes a definition text refers to is shown", () => {
    const wire = new Wire("See [docs].\n\n[docs]: https://example.com\n");
    wire.host.change("See [docs].\n");
    wire.drain();
    expect(wire.state.doc.childCount).toBe(1);
    expect(wire.state.doc.textContent).toBe("See [docs].");
  });
});
