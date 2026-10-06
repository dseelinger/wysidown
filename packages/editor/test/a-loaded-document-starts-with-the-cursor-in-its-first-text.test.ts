import { TextSelection } from "prosemirror-state";
import { expect, test } from "vitest";
import { Wire } from "./support/wire.ts";

test("a loaded document starts with the cursor in its first text, after front matter", () => {
  const wire = new Wire("---\ntitle: Notes\n---\n\nFirst words.\n");
  const { selection } = wire.state;
  expect(selection).toBeInstanceOf(TextSelection);
  expect(selection.$head.parent.textContent).toBe("First words.");
  expect(selection.$head.parentOffset).toBe(0);
});

test("a loaded document with no text starts with the cursor at its start", () => {
  const wire = new Wire("---\ntitle: Notes\n---\n");
  expect(wire.state.selection.from).toBe(0);
});
