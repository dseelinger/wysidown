import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../src/markdown/parse.ts";
import { serializeMarkdown, writeMarkdown } from "../src/markdown/serialize.ts";
import { fixtures, realisticCases } from "./support/corpus.ts";

const walkEverything = { inlineSplice: true, inlineRewrite: true, widen: false, forceDescend: true };

describe("an unedited document saves to the same bytes", () => {
  test.each(realisticCases())("$name", ({ text }) => {
    const source = parseMarkdown(text);
    expect(serializeMarkdown(source, source.doc)).toEqual({ text, verified: true, step: "minimal" });
  });

  test.each(realisticCases())("$name, rebuilt from every container's children and gaps", ({ text }) => {
    const source = parseMarkdown(text);
    expect(writeMarkdown(source, source.doc, walkEverything)).toBe(text);
  });

  test("every GFM spec example, rebuilt from every container's children and gaps", () => {
    const changed = fixtures("spec")
      .filter(({ text }) => writeMarkdown(parseMarkdown(text), parseMarkdown(text).doc, walkEverything) !== text)
      .map((f) => f.name);
    expect(changed).toEqual([]);
  });

  test("an empty file saves as an empty file", () => {
    const source = parseMarkdown("");
    expect(serializeMarkdown(source, source.doc).text).toBe("");
  });
});
