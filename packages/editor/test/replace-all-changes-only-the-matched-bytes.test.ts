import { parseMarkdown } from "@wysidown/core";
import { undo } from "prosemirror-history";
import { describe, expect, test } from "vitest";
import { realisticCases } from "./support/corpus.ts";
import { findIn, query } from "./support/find.ts";
import { wordEnd } from "./support/words.ts";

const snowman = "☃";

/** The first word of three or more letters in `text` whose characters map to the source. */
function wordIn(text: string): string | null {
  const end = wordEnd(parseMarkdown(text));
  if (!end) return null;
  const doc = parseMarkdown(text).doc;
  const $end = doc.resolve(end.pos);
  return /[A-Za-z]+$/.exec(doc.textBetween($end.start(), end.pos, "", "￼"))![0];
}

describe("Replace All changes only the matched bytes", () => {
  test.each(realisticCases())("replacing every whole-word match of a word in $name", ({ text }) => {
    const word = wordIn(text);
    if (word === null) return;
    const { wire, find } = findIn(text);
    find.setQuery(query(word, { replace: snowman, caseSensitive: true, wholeWord: true }), false);
    const { total } = find.matches();
    expect(total).toBeGreaterThan(0);
    find.replaceAll();
    wire.drain();
    expect(wire.host.text.split(snowman).length - 1).toBe(total);
    expect(wire.host.text.replaceAll(snowman, word)).toBe(text);
    expect(find.matches().total).toBe(0);
  });

  test.each([
    { name: "lf", eol: "\n", bom: "" },
    { name: "crlf", eol: "\r\n", bom: "" },
    { name: "bom", eol: "\n", bom: "﻿" },
  ])("matches in bold text and link text, not in the link's target ($name)", ({ eol, bom }) => {
    const lines = ["The cat sat.", "", "**The cat** ran to [the cat](https://cat.example).", ""];
    const text = bom + lines.join(eol);
    const { wire, find } = findIn(text);
    find.setQuery(query("cat", { replace: "dog", wholeWord: true }), false);
    expect(find.matches().total).toBe(3);
    find.replaceAll();
    wire.drain();
    expect(wire.host.text).toBe(
      bom + ["The dog sat.", "", "**The dog** ran to [the dog](https://cat.example).", ""].join(eol),
    );
    expect(wire.edits).toHaveLength(1);
  });

  test("a regular expression's replacement may use $1 and $&, and keeps the marks of the text it keeps", () => {
    const text = "Call ext **1234** or _ext 5678_.\n";
    const { wire, find } = findIn(text);
    find.setQuery(query("ext (\\d+)", { replace: "$& (no. $1)", regexp: true }), false);
    find.replaceAll();
    wire.drain();
    expect(wire.host.text).toBe("Call ext **1234** (no. **1234**) or _ext 5678 (no. 5678)_.\n");
  });

  test("Replace All is one undo step", () => {
    const text = "one two one two one\n";
    const { wire, find } = findIn(text);
    find.setQuery(query("one", { replace: "1" }), false);
    find.replaceAll();
    wire.drain();
    expect(wire.host.text).toBe("1 two 1 two 1\n");
    undo(wire.state, (tr) => {
      wire.session.update(wire.state.apply(tr), tr);
    });
    wire.drain();
    expect(wire.host.text).toBe(text);
  });
});
