import { Transform } from "prosemirror-transform";
import { describe, expect, test } from "vitest";
import { serializeMarkdown } from "../src/markdown/serialize.ts";
import { realisticCases } from "./support/corpus.ts";
import { editCases, type EditKind } from "./support/edits.ts";

const kinds: readonly EditKind[] = ["word", "markdown characters", "bold", "insert", "delete", "toggle"];

describe("undoing an edit restores the original bytes", () => {
  // Undo applies inverted steps, which rebuild the edited nodes rather than reusing the originals.
  test.each(realisticCases())("$name", ({ text }) => {
    const changed = kinds.flatMap((kind) =>
      editCases(text, kind).flatMap(({ label, transform, source }) => {
        const undo = new Transform(transform.doc);
        for (let i = transform.steps.length - 1; i >= 0; i--) {
          undo.step(transform.steps[i]!.invert(transform.docs[i]!));
        }
        return serializeMarkdown(source, undo.doc).text === text ? [] : [label];
      }),
    );
    expect(changed).toEqual([]);
  });
});
