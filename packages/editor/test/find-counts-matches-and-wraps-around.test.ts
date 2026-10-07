import { TextSelection } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import { findIn, query } from "./support/find.ts";

describe("find counts matches and wraps around", () => {
  test("typing a query selects the first match from the cursor, and Next and Previous wrap", () => {
    const { wire, find } = findIn("one two one three one\n");
    find.setQuery(query("one"), true);
    expect(find.matches()).toEqual({ current: 1, total: 3 });
    find.findNext();
    expect(find.matches()).toEqual({ current: 2, total: 3 });
    find.findNext();
    find.findNext();
    expect(find.matches()).toEqual({ current: 1, total: 3 });
    find.findPrevious();
    expect(find.matches()).toEqual({ current: 3, total: 3 });
    expect(wire.edits).toEqual([]);
  });

  test("a selection that is not a match counts as no current match", () => {
    const { find } = findIn("one two one\n");
    find.setQuery(query("one"), false);
    expect(find.matches()).toEqual({ current: 0, total: 2 });
  });

  test("match case, whole word and regular expression narrow the matches", () => {
    const { find } = findIn("Cat cat category CAT\n");
    find.setQuery(query("cat"), false);
    expect(find.matches().total).toBe(4);
    find.setQuery(query("cat", { caseSensitive: true }), false);
    expect(find.matches().total).toBe(2);
    find.setQuery(query("cat", { wholeWord: true }), false);
    expect(find.matches().total).toBe(3);
    find.setQuery(query("^cat", { regexp: true }), false);
    expect(find.matches().total).toBe(1);
    find.setQuery(query("(", { regexp: true }), false);
    expect(find.matches().total).toBe(0);
  });

  test("Replace replaces the selected match and selects the next", () => {
    const { wire, find } = findIn("a1 a2 a3\n");
    find.setQuery(query("a", { replace: "b" }), true);
    find.replace();
    wire.drain();
    expect(wire.host.text).toBe("b1 a2 a3\n");
    expect(find.matches()).toEqual({ current: 1, total: 2 });
    find.replace();
    wire.drain();
    expect(wire.host.text).toBe("b1 b2 a3\n");
  });

  test("the query carries over to a document the host loads", () => {
    const { wire, find } = findIn("one\n");
    find.setQuery(query("two"), false);
    wire.host.load("two two\n");
    wire.drain();
    expect(find.matches().total).toBe(2);
  });

  test("a cleared query matches nothing", () => {
    const { find } = findIn("one one\n");
    find.setQuery(query("one"), false);
    find.setQuery(null, false);
    expect(find.matches().total).toBe(0);
    expect(find.selectedText()).toBe("");
  });

  test("a space in a query matches a soft line break, which shows as a space", () => {
    const { wire, find } = findIn("That makes review painful.\nA one-word change.\n");
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, 19, 29)));
    expect(find.selectedText()).toBe("painful. A");
    find.setQuery(query(find.selectedText(), { replace: "fine. A" }), false);
    expect(find.matches()).toEqual({ current: 1, total: 1 });
    find.replaceAll();
    wire.drain();
    expect(wire.host.text).toBe("That makes review fine. A one-word change.\n");
  });

  test("a line break in code is not matched by a space", () => {
    const { find } = findIn("```\na\nb\n```\n");
    find.setQuery(query("a b"), false);
    expect(find.matches().total).toBe(0);
  });

  test("a plain query and its replacement are taken as written", () => {
    const { wire, find } = findIn("Use a+b (c) here.\n");
    find.setQuery(query("a+b (c)", { replace: "a-b (c) $1 $&" }), false);
    expect(find.matches().total).toBe(1);
    find.replaceAll();
    expect(wire.state.doc.textContent).toBe("Use a-b (c) $1 $& here.");
  });

  test("a regular expression does not match an image, so a replacement cannot delete it", () => {
    const text = "see ![logo](a.png) here\n";
    const { wire, find } = findIn(text);
    find.setQuery(query("see .", { regexp: true, replace: "see" }), false);
    expect(find.matches().total).toBe(0);
    find.replaceAll();
    wire.drain();
    expect(wire.host.text).toBe(text);
  });
});
