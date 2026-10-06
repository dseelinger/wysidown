import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { fixtures, realisticCases } from "./support/corpus.ts";
import { editCases, type EditKind } from "./support/edits.ts";

const kinds: readonly EditKind[] = [
  "word",
  "markdown characters",
  "bold",
  "insert",
  "delete",
  "toggle",
  "new item",
  "new row",
  "delete row",
  "new column",
  "delete column",
  "align",
  "code word",
  "code line",
  "language",
];

/** Realistic-corpus edits that change more than the edited block, by design. */
const wider = new Set([
  // Editing the text of a shortcut reference turns it into a full reference, so it still resolves.
  "25-changelog.md word#4",
  // Deleting the block between two lists of the same kind rewrites them so they do not merge.
  "05-lists-loose-tight.md delete#3",
  "05-lists-loose-tight.md delete#5",
  "23-ordered-numbering.md delete#3",
  "23-ordered-numbering.md delete#5",
  "23-ordered-numbering.md delete#11",
  "23-ordered-numbering.md delete#13",
  "25-changelog.md delete#7",
  "25-changelog.md delete#12",
  "28-meeting-notes.md delete#7",
]);

describe("an edit changes only its own bytes", () => {
  test.each(realisticCases())("$name", ({ name, text }) => {
    const file = name.replace(/ \(.*\)$/, "");
    const notPassing = kinds.flatMap((kind) =>
      editCases(text, kind)
        .filter((c) => c.outcome === "serializer" || c.outcome === "too-wide")
        .map((c) => `${file} ${c.label}: ${c.outcome}`),
    );
    const expected = [...wider].filter((w) => w.startsWith(`${file} `)).map((w) => `${w}: too-wide`);
    expect(notPassing).toEqual(expected);
  });

  test("GFM spec examples fail only as listed in spec-known-failures.txt", () => {
    const listed = readFileSync(join(import.meta.dirname, "corpus", "spec-known-failures.txt"), "utf8")
      .split("\n")
      .map((line) => line.replace(/(^|\s)#.*$/, "").trim())
      .filter((line) => line !== "");
    const failing = fixtures("spec").flatMap((f) =>
      kinds.flatMap((kind) =>
        editCases(f.text, kind)
          .filter((c) => c.outcome === "serializer")
          .map((c) => `${f.name} ${c.label}`),
      ),
    );
    expect(failing).toEqual(listed);
  });
});
