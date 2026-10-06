import { byteOrderMark } from "../src/text/byte-order-mark.ts";
import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../src/markdown/parse.ts";
import { fixtures, variant } from "./support/corpus.ts";
import { editCases, type EditKind } from "./support/edits.ts";

const kinds: readonly EditKind[] = ["word", "bold", "insert", "delete"];

describe("a saved file keeps its line endings and byte order mark", () => {
  test.each(fixtures("realistic"))("$name with CRLF line endings saves with CRLF only", ({ text }) => {
    const crlf = variant(text, "crlf");
    const lone = kinds.flatMap((kind) =>
      editCases(crlf, kind)
        .filter((c) => /(^|[^\r])\n/.test(c.output))
        .map((c) => c.label),
    );
    expect(lone).toEqual([]);
  });

  test.each(fixtures("realistic"))("$name with a byte order mark keeps exactly one", ({ text }) => {
    const bom = variant(text, "bom");
    const wrong = kinds.flatMap((kind) =>
      editCases(bom, kind)
        .filter((c) => !c.output.startsWith(byteOrderMark) || c.output.startsWith(byteOrderMark + byteOrderMark))
        .map((c) => c.label),
    );
    expect(wrong).toEqual([]);
  });

  test("the document model holds no carriage returns, whatever the file uses", () => {
    const text = variant(
      fixtures("realistic")
        .map((f) => f.text)
        .join("\n"),
      "crlf",
    );
    expect(parseMarkdown(text).doc.textContent).not.toContain("\r");
  });
});
