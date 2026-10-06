import { schema } from "@wysidown/core";
import { Fragment, Slice, type Node } from "prosemirror-model";
import { TextSelection, type Command } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import {
  addColumn,
  addRow,
  alignColumn,
  cellBelow,
  deleteColumn,
  deleteRow,
  nextCell,
  oneLine,
  previousCell,
  tableKeys,
} from "../src/tables.ts";
import { Wire } from "./support/wire.ts";

const table = "Before.\n\n| Key   | Value |\n| ----- | :---- |\n| alpha | 1     |\n| beta  | 2     |\n\nAfter.\n";

/** `table` with its table lines replaced by `lines`. */
function withLines(...lines: string[]): string {
  return `Before.\n\n${lines.join("\n")}\n\nAfter.\n`;
}

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

/** A wire holding `text` with the cursor after `at`. */
function cursorAfter(text: string, at: string): Wire {
  const wire = new Wire(text);
  wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, after(s.doc, at))));
  return wire;
}

/** Loads `text`, puts the cursor after `at`, runs each command, types `typed`, and returns the host's text. */
function edited(text: string, at: string, commands: Command[], typed = ""): string {
  const wire = cursorAfter(text, at);
  for (const command of commands) {
    const ran = command(wire.state, (tr) => {
      wire.session.update(wire.state.apply(tr));
    });
    expect(ran).toBe(true);
  }
  if (typed) wire.edit((s) => s.tr.insertText(typed));
  wire.drain();
  return wire.host.text;
}

describe("tables gain and lose rows and columns from the keyboard and menu", () => {
  test("Tab moves to the next cell, and from the last cell adds a padded row", () => {
    expect(edited(table, "Key", [nextCell], "!")).toBe(table.replace("| Value |", "| Value! |"));
    expect(edited(table, "2", [nextCell], "c")).toBe(table.replace("| 2     |\n", "| 2     |\n| c     |       |\n"));
  });

  test("Shift-Tab moves to the end of the cell before, across rows, and stays in the first cell", () => {
    expect(edited(table, "beta", [previousCell], "!")).toBe(table.replace("| 1     |", "| 1!     |"));
    expect(edited(table, "Key", [previousCell], "!")).toBe(table.replace("| Key   |", "| Key!   |"));
  });

  test("Enter moves to the cell below, and from the last row adds a row", () => {
    expect(edited(table, "alpha", [cellBelow], "!")).toBe(table.replace("| beta  |", "| beta!  |"));
    expect(edited(table, "2", [cellBelow], "3")).toBe(table.replace("| 2     |\n", "| 2     |\n|       | 3     |\n"));
  });

  test("Backspace at the start of a cell and Delete at its end leave the cell as it is", () => {
    const wire = cursorAfter(table, "Key");
    expect(tableKeys["Delete"]!(wire.state)).toBe(true);
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, after(s.doc, "Value") - "Value".length)));
    expect(tableKeys["Backspace"]!(wire.state)).toBe(true);
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, after(s.doc, "Val"))));
    expect(tableKeys["Backspace"]!(wire.state)).toBe(false);
    expect(tableKeys["Delete"]!(wire.state)).toBe(false);
  });

  test("rows are added above and below the cursor's row and deleted, but the header row stays first", () => {
    expect(edited(table, "beta", [addRow("above")], "x")).toBe(table.replace("| beta ", "| x     |       |\n| beta "));
    expect(edited(table, "Key", [addRow("below")], "x")).toBe(table.replace("| alpha ", "| x     |       |\n| alpha "));
    expect(edited(table, "alpha", [deleteRow])).toBe(table.replace("| alpha | 1     |\n", ""));
    expect(addRow("above")(cursorAfter(table, "Key").state)).toBe(false);
    expect(deleteRow(cursorAfter(table, "Key").state)).toBe(false);
    expect(addRow("below")(cursorAfter(table, "Before").state)).toBe(false);
  });

  test("columns are added either side of the cursor's column and deleted, but not a table's only column", () => {
    expect(edited(table, "1", [addColumn("right")], "x")).toBe(
      withLines(
        "| Key   | Value |     |",
        "| ----- | :---- | --- |",
        "| alpha | 1     | x   |",
        "| beta  | 2     |     |",
      ),
    );
    expect(edited(table, "alpha", [addColumn("left")])).toBe(
      withLines(
        "|     | Key   | Value |",
        "| --- | ----- | :---- |",
        "|     | alpha | 1     |",
        "|     | beta  | 2     |",
      ),
    );
    expect(edited(table, "Key", [deleteColumn])).toBe(withLines("| Value |", "| :---- |", "| 1     |", "| 2     |"));
    expect(deleteColumn(cursorAfter("| One |\n| --- |\n| 1 |\n", "One").state)).toBe(false);
  });

  test("aligning a column changes only its delimiter cell", () => {
    expect(edited(table, "alpha", [alignColumn("center")])).toBe(table.replace("| ----- |", "| :---: |"));
    expect(edited(table, "1", [alignColumn(null)])).toBe(table.replace(":----", "-----"));
  });

  test("blocks pasted into a cell become one line", () => {
    const pasted = new Slice(
      Fragment.fromArray([
        schema.nodes.paragraph.create(null, schema.text("one")),
        schema.nodes.paragraph.create(null, [
          schema.text("two"),
          schema.nodes.hard_break.create(),
          schema.text("three"),
        ]),
      ]),
      1,
      1,
    );
    const wire = cursorAfter(table, "alpha");
    wire.edit((s) => s.tr.replaceSelection(oneLine(pasted)));
    wire.drain();
    expect(wire.host.text).toBe(table.replace("| alpha |", "| alphaone two three |"));
  });
});
