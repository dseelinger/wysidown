import { parseMarkdown } from "@wysidown/core";
import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import { formatKeys } from "../src/format.ts";
import { realisticCases } from "./support/corpus.ts";
import { press, type } from "./support/typing.ts";
import { Wire } from "./support/wire.ts";
import { wordEnd } from "./support/words.ts";

/** The positions of the first occurrence of `find` in a textblock of `doc`. */
function range(doc: Node, find: string): { from: number; to: number } {
  let from = -1;
  doc.descendants((node, pos) => {
    if (from >= 0 || !node.isTextblock) return from < 0;
    const k = node.textContent.indexOf(find);
    if (k >= 0) from = pos + 1 + k;
    return false;
  });
  if (from < 0) throw new Error(`"${find}" is not in the document`);
  return { from, to: from + find.length };
}

/** A wire on `text` with `find` selected, or the cursor at its start when `empty`. */
function wireWith(text: string, find: string, empty = false, hold = 0): Wire {
  const wire = new Wire(text, hold);
  const { from, to } = range(wire.state.doc, find);
  wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, from, empty ? from : to)));
  return wire;
}

/** Loads `text`, selects `find`, presses `keys` in turn, and returns the host's text. */
function pressed(text: string, find: string, ...keys: string[]): string {
  const wire = wireWith(text, find);
  for (const key of keys) press(wire, formatKeys[key]!);
  wire.drain();
  return wire.host.text;
}

describe("a mark key toggles its mark on the selection", () => {
  const text = "Intro.\n\nSecond paragraph here.\n";

  test.each([
    ["Mod-b", "**paragraph**"],
    ["Mod-i", "*paragraph*"],
    ["Shift-Mod-x", "~~paragraph~~"],
    ["Mod-e", "`paragraph`"],
  ])("%s", (key, saved) => {
    expect(pressed(text, "paragraph", key)).toBe(`Intro.\n\nSecond ${saved} here.\n`);
  });

  test("pressing the key again removes the mark", () => {
    expect(pressed(text, "paragraph", "Mod-b", "Mod-b")).toBe(text);
    expect(pressed("A **bold** word.\n", "bold", "Mod-b")).toBe("A bold word.\n");
  });

  test("marks are written in the document's own style", () => {
    expect(pressed("An _old_ one.\n\nA new one.\n", "new", "Mod-i")).toBe("An _old_ one.\n\nA _new_ one.\n");
    expect(pressed("An __old__ one.\n\nA new one.\n", "new", "Mod-b")).toBe("An __old__ one.\n\nA __new__ one.\n");
  });

  test("with an empty selection the key formats the text typed next", () => {
    for (const hold of [0, 1000]) {
      const wire = wireWith(text, "here", true, hold);
      press(wire, formatKeys["Mod-b"]!);
      type(wire, "bold");
      press(wire, formatKeys["Mod-b"]!);
      type(wire, " plain ");
      wire.session.sendHeld();
      wire.drain();
      expect(wire.host.text).toBe("Intro.\n\nSecond paragraph **bold** plain here.\n");
    }
  });

  test("a mark key in a code block changes nothing and still takes the key", () => {
    const wire = wireWith("```\ncode here\n```\n", "code");
    expect(press(wire, formatKeys["Mod-b"]!)).toBe(true);
    wire.drain();
    expect(wire.host.text).toBe("```\ncode here\n```\n");
  });
});

describe("a heading key sets the block's heading level, or back to a paragraph", () => {
  test.each([1, 2, 3, 4, 5, 6])("Mod-%i", (level) => {
    expect(pressed("Intro.\n\nSecond.\n", "Second", `Mod-${String(level)}`)).toBe(
      `Intro.\n\n${"#".repeat(level)} Second.\n`,
    );
  });

  test("a heading changes level, and its own level's key makes it a paragraph", () => {
    expect(pressed("# Title\n\nText.\n", "Title", "Mod-3")).toBe("### Title\n\nText.\n");
    expect(pressed("## Title\n\nText.\n", "Title", "Mod-2")).toBe("Title\n\nText.\n");
  });

  test("inside a list item or a quote only that block changes", () => {
    expect(pressed("- one\n- two\n- three\n", "two", "Mod-2")).toBe("- one\n- ## two\n- three\n");
    expect(pressed("> a\n>\n> b\n", "b", "Mod-1")).toBe("> a\n>\n> # b\n");
  });

  test("a code block and a task item's text stay as they are", () => {
    expect(pressed("```\ncode\n```\n", "code", "Mod-1")).toBe("```\ncode\n```\n");
    expect(pressed("- [ ] task\n", "task", "Mod-1")).toBe("- [ ] task\n");
  });
});

describe("a format key changes only its own block's bytes", () => {
  test.each(realisticCases())("in $name", ({ text }) => {
    const source = parseMarkdown(text);
    const word = wordEnd(source)!;
    const block = source.ranges.get(source.doc.child(word.block))!;
    const bom = source.bom ? 1 : 0;
    for (const key of Object.keys(formatKeys)) {
      const wire = new Wire(text);
      wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, word.pos - 3, word.pos)));
      press(wire, formatKeys[key]!);
      wire.drain();
      const saved = wire.host.text;
      if (key === "Mod-b") expect(saved).not.toBe(text);
      const after = text.length - block.end - bom;
      expect(saved.slice(0, block.start + bom), key).toBe(text.slice(0, block.start + bom));
      expect(saved.slice(saved.length - after), key).toBe(text.slice(text.length - after));
    }
  });
});
