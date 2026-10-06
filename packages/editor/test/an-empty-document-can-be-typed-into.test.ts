import { schema } from "@wysidown/core";
import { TextSelection } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import { Wire } from "./support/wire.ts";

/** Types `text` at the cursor. */
function type(wire: Wire, text: string): void {
  wire.edit((state) => state.tr.insertText(text));
  wire.drain();
}

describe.each([
  ["an empty file", ""],
  ["a file holding only blank lines", "\n\n"],
  ["a CRLF file holding only blank lines", "\r\n\r\n"],
  ["an empty file with a byte order mark", "﻿"],
])("%s", (_name, text) => {
  test("loads with the cursor in an empty paragraph and sends no edit", () => {
    const wire = new Wire(text);
    expect(wire.state.doc.childCount).toBe(1);
    expect(wire.state.doc.firstChild!.type).toBe(schema.nodes.paragraph);
    expect(wire.state.selection).toBeInstanceOf(TextSelection);
    expect(wire.state.selection.$head.parent.type).toBe(schema.nodes.paragraph);
    expect(wire.edits).toEqual([]);
    expect(wire.host.text).toBe(text);
  });

  test("takes typed text, and undo restores the original bytes", () => {
    const wire = new Wire(text);
    type(wire, "Hello");
    const bom = text.startsWith("﻿") ? "﻿" : "";
    expect(wire.host.text).toBe(bom + "Hello" + text.replace(bom, ""));
    wire.edit((state) => state.tr.delete(1, 6));
    wire.drain();
    expect(wire.host.text).toBe(text);
  });
});

test("typing into an empty file saves exactly the typed text", () => {
  const wire = new Wire("");
  type(wire, "Hello");
  expect(wire.host.text).toBe("Hello");
});

test("deleting everything leaves an empty paragraph to type into and an empty file", () => {
  const wire = new Wire("# Title\n\nSome words.\n");
  wire.edit((state) => state.tr.delete(0, state.doc.content.size));
  wire.drain();
  expect(wire.state.doc.childCount).toBe(1);
  expect(wire.state.doc.firstChild!.type).toBe(schema.nodes.paragraph);
  expect(wire.host.text.trim()).toBe("");
  type(wire, "New");
  expect(wire.host.text.trim()).toBe("New");
});

test("an external change that empties the file leaves an empty paragraph, and typing then works", () => {
  const wire = new Wire("Some words.\n");
  wire.host.change("");
  wire.drain();
  expect(wire.state.doc.childCount).toBe(1);
  expect(wire.state.doc.firstChild!.content.size).toBe(0);
  expect(wire.edits).toEqual([]);
  wire.edit((state) => state.tr.setSelection(TextSelection.create(state.doc, 1)).insertText("Hi"));
  wire.drain();
  expect(wire.host.text).toBe("Hi");
});

test("an external change that fills an empty file replaces the empty paragraph", () => {
  const wire = new Wire("");
  wire.host.change("Some words.\n");
  wire.drain();
  expect(wire.state.doc.childCount).toBe(1);
  expect(wire.state.doc.firstChild!.textContent).toBe("Some words.");
  expect(wire.edits).toEqual([]);
  expect(wire.host.text).toBe("Some words.\n");
});
