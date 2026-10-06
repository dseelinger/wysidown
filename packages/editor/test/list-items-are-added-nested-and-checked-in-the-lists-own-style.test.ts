import type { Node } from "prosemirror-model";
import { TextSelection, type Command } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import { liftItem, sinkItem, splitItem, toggleTask } from "../src/lists.ts";
import { Wire } from "./support/wire.ts";

/** The position just after the first occurrence of `text` in a textblock of `doc`. */
function after(doc: Node, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0 || !node.isTextblock) return found < 0;
    const at = node.textContent.indexOf(text);
    if (at >= 0) found = pos + 1 + at + text.length;
    return false;
  });
  if (found < 0) throw new Error(`"${text}" is not in the document`);
  return found;
}

/** Loads `text`, puts the cursor after `at`, runs `command`, types `typed`, and returns the host's text. */
function edited(text: string, at: string, command: Command, typed = ""): string {
  const wire = new Wire(text);
  wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, after(s.doc, at))));
  const ran = command(wire.state, (tr) => {
    wire.session.update(wire.state.apply(tr));
  });
  expect(ran).toBe(true);
  if (typed) wire.edit((s) => s.tr.insertText(typed));
  wire.drain();
  return wire.host.text;
}

describe("list items are added, nested and checked in the list's own style", () => {
  test("Enter at the end of an item adds an item with the list's marker", () => {
    expect(edited("Text.\n\n* one\n* two\n", "one", splitItem, "new")).toBe("Text.\n\n* one\n* new\n* two\n");
  });

  test("Enter in an ordered list numbers the new item after the one before it", () => {
    expect(edited("1) one\n2) two\n", "two", splitItem, "new")).toBe("1) one\n2) two\n3) new\n");
  });

  test("Enter in a list numbered all ones adds a one", () => {
    expect(edited("1. one\n1. two\n", "one", splitItem, "new")).toBe("1. one\n1. new\n1. two\n");
  });

  test("Enter in a loose list keeps the blank line between items", () => {
    expect(edited("- one\n\n- two\n", "one", splitItem, "new")).toBe("- one\n\n- new\n\n- two\n");
  });

  test("Enter in a checked task adds an unchecked task", () => {
    expect(edited("- [x] done\n- [ ] todo\n", "done", splitItem, "new")).toBe("- [x] done\n- [ ] new\n- [ ] todo\n");
  });

  test("Enter in a nested list adds an item lined up with its siblings", () => {
    expect(edited("1. top\n   - a\n   - b\n2. next\n", "a", splitItem, "new")).toBe(
      "1. top\n   - a\n   - new\n   - b\n2. next\n",
    );
  });

  test("Enter on an empty nested task adds a plain item to the list around it", () => {
    const wire = new Wire("- a\n  - [ ] b\n");
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, after(s.doc, "b"))));
    for (let k = 0; k < 2; k++) {
      splitItem(wire.state, (tr) => {
        wire.session.update(wire.state.apply(tr));
      });
    }
    wire.edit((s) => s.tr.insertText("c"));
    wire.drain();
    expect(wire.host.text).toBe("- a\n  - [ ] b\n- c\n");
  });

  test("Tab nests an item under the one before it", () => {
    expect(edited("- a\n- b\n- c\n", "b", sinkItem)).toBe("- a\n  - b\n- c\n");
  });

  test("Shift-Tab moves a nested item out to the list around it", () => {
    expect(edited("- a\n  - b\n- c\n", "b", liftItem)).toBe("- a\n- b\n- c\n");
  });

  test("Tab on the first item, which cannot be nested, is still handled by the list", () => {
    const wire = new Wire("- a\n- b\n");
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, after(s.doc, "a"))));
    expect(sinkItem(wire.state)).toBe(true);
    expect(sinkItem(new Wire("Text.\n").state)).toBe(false);
  });

  test("checking a task changes one character", () => {
    const text = "- [ ] Update the website\n  - [x] Screenshots\n";
    const wire = new Wire(text);
    const positions: number[] = [];
    wire.state.doc.descendants((node, pos) => {
      if (node.type.name === "list_item") positions.push(pos);
      return true;
    });
    for (const pos of positions) {
      toggleTask(pos)(wire.state, (tr) => {
        wire.session.update(wire.state.apply(tr));
      });
      wire.drain();
    }
    expect(wire.host.text).toBe("- [x] Update the website\n  - [ ] Screenshots\n");
    expect(wire.edits.map((e) => e.edits)).toEqual([
      [{ start: 3, end: 4, insert: "x" }],
      [{ start: 30, end: 31, insert: " " }],
    ]);
  });

  test("an item that is not a task cannot be checked", () => {
    const wire = new Wire("- plain\n");
    expect(toggleTask(1)(wire.state)).toBe(false);
  });
});
