import { describe, expect, test } from "vitest";
import { applyEdits, diffText } from "../src/text/edits.ts";
import { realisticCases } from "./support/corpus.ts";
import { editCases } from "./support/edits.ts";

describe("a text diff covers only what changed", () => {
  test("equal texts give no edit", () => {
    expect(diffText("same", "same")).toBeNull();
  });

  test("an insertion is an empty range holding only the inserted characters", () => {
    const edit = diffText("one three", "one two three")!;
    expect(edit.end - edit.start).toBe(0);
    expect(edit.insert).toHaveLength(4);
    expect(applyEdits("one three", [edit])).toBe("one two three");
  });

  test("a replacement covers only the differing span", () => {
    expect(diffText("the cat sat", "the dog sat")).toEqual({ start: 4, end: 7, insert: "dog" });
  });

  test("an edit never splits a CRLF", () => {
    const edit = diffText("a\r\nb", "a\r\r\nb")!;
    expect(edit.start).not.toBe(2);
    expect(applyEdits("a\r\nb", [edit])).toBe("a\r\r\nb");
  });

  test("an edit never splits a surrogate pair", () => {
    const before = "x\u{1F600}y";
    const after = "x\u{1F601}y";
    const edit = diffText(before, after)!;
    expect(edit).toEqual({ start: 1, end: 3, insert: "\u{1F601}" });
  });

  test("applying edits that overlap is refused", () => {
    expect(() =>
      applyEdits("abcdef", [
        { start: 0, end: 3, insert: "" },
        { start: 2, end: 4, insert: "" },
      ]),
    ).toThrow(RangeError);
  });

  test.each(realisticCases().filter((c) => c.name.includes("(crlf)")))(
    "applying the diff of every corpus edit reproduces the saved text: $name",
    ({ text }) => {
      const wrong = editCases(text, "word")
        .concat(editCases(text, "insert"))
        .filter((c) => {
          const edit = diffText(text, c.output);
          return (edit ? applyEdits(text, [edit]) : text) !== c.output;
        })
        .map((c) => c.label);
      expect(wrong).toEqual([]);
    },
  );
});
