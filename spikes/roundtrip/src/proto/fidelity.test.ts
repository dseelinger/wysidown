import { describe, expect, test } from "vitest";
import { load, variant, variants } from "../corpus.ts";
import { identity, wordEdits, markEdits, insertEdits, deleteEdits, taskToggles } from "./edits.ts";

const realistic = load("realistic");
const cases = realistic.flatMap((f) => variants.map((v) => ({ name: `${f.name} (${v})`, text: variant(f.text, v) })));

describe("the ProseMirror + mdast prototype", () => {
  test.each(cases)("an unedited document saves to the same bytes: $name", ({ text }) => {
    expect(identity(text)).toBe(true);
  });

  test("every GFM spec example saves to the same bytes except the overlapping-definition case", () => {
    const failing = load("spec")
      .filter((f) => !identity(f.text))
      .map((f) => f.name);
    expect(failing).toEqual(["184-link-reference-definitions.md"]);
  });

  test.each(cases)("editing one word changes only that word's bytes: $name", ({ text }) => {
    // A shortcut reference link whose text is edited is rewritten as a full reference, by design.
    expect(wordEdits(text).failures.filter((f) => !f.endsWith("too-wide"))).toEqual([]);
  });

  test.each(cases)("typing markdown characters changes only that block's bytes: $name", ({ text }) => {
    expect(wordEdits(text, "a*b_[c]`d").failures).toEqual([]);
  });

  test.each(cases)("making a word bold changes only that block's bytes: $name", ({ text }) => {
    expect(markEdits(text).failures).toEqual([]);
  });

  test.each(cases)("inserting a paragraph leaves the rest of the document unchanged: $name", ({ text }) => {
    expect(insertEdits(text).failures).toEqual([]);
  });

  test.each(cases)("deleting a block never needs a serializer fix: $name", ({ text }) => {
    // too-wide: deleting the block between two lists rewrites the neighbours so they stay apart.
    // inherent: deleting a link or footnote definition changes the paragraphs that reference it.
    expect(deleteEdits(text).failures.filter((f) => f.endsWith("serializer"))).toEqual([]);
  });

  test.each(cases)("toggling a task checkbox changes one character: $name", ({ text }) => {
    expect(taskToggles(text).failures).toEqual([]);
  });
});
