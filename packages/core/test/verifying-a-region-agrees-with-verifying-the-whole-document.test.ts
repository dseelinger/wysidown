import { describe, expect, test } from "vitest";
import { Transform } from "prosemirror-transform";
import { parseMarkdown } from "../src/markdown/parse.ts";
import { schema } from "../src/markdown/schema.ts";
import { writeMarkdown } from "../src/markdown/serialize.ts";
import { verifyRegion, verifyWhole } from "../src/markdown/verify.ts";
import { fixtures, realisticCases } from "./support/corpus.ts";
import { editCases, type EditKind } from "./support/edits.ts";

const kinds: readonly EditKind[] = [
  "word",
  "markdown characters",
  "bold",
  "insert",
  "delete",
  "toggle",
  "code word",
  "code line",
  "language",
];
const everyStep = [
  { inlineSplice: true, inlineRewrite: true, widen: false },
  { inlineSplice: false, inlineRewrite: false, widen: false },
  { inlineSplice: true, inlineRewrite: true, widen: true },
];

/** Region and whole-document verdicts that differ, for every edit and every write step. */
function disagreements(text: string): string[] {
  return kinds.flatMap((kind) =>
    editCases(text, kind).flatMap((c) =>
      everyStep.flatMap((options, step) => {
        const output = writeMarkdown(c.source, c.doc, options);
        const region = verifyRegion(c.source, c.doc, output);
        return region === null || region === verifyWhole(c.doc, output)
          ? []
          : [`${c.label} step ${step}: region=${region}`];
      }),
    ),
  );
}

describe("verifying a region agrees with verifying the whole document", () => {
  test.each(realisticCases())("$name", ({ text }) => {
    expect(disagreements(text)).toEqual([]);
  });

  test("every GFM spec example", () => {
    expect(fixtures("spec").flatMap((f) => disagreements(f.text).map((d) => `${f.name} ${d}`))).toEqual([]);
  });

  test("a word edit in a 360 KB document is verified from its region alone", () => {
    const one = fixtures("realistic")
      .map((f) => f.text)
      .join("\n");
    const source = parseMarkdown(Array.from({ length: 30 }, () => one).join("\n"));
    let at = -1;
    source.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && /^[A-Za-z]{3}/.test(node.text!)) at = pos;
      return at < 0;
    });
    const doc = new Transform(source.doc).replaceWith(at, at + 3, schema.text("XYZ")).doc;
    const output = writeMarkdown(source, doc, everyStep[0]!);
    expect(verifyRegion(source, doc, output)).toBe(true);
  });
});
