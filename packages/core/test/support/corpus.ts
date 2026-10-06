import { byteOrderMark } from "../../src/text/byte-order-mark.ts";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { filesUnder } from "./repo.ts";

export type Variant = "lf" | "crlf" | "bom" | "no-final-newline";
export const variants: readonly Variant[] = ["lf", "crlf", "bom", "no-final-newline"];

export interface Fixture {
  name: string;
  text: string;
}

const corpus = join(import.meta.dirname, "..", "corpus");

/** The fixtures of one corpus set, in file name order. */
export function fixtures(set: "realistic" | "spec"): Fixture[] {
  return filesUnder(join(corpus, set), /\.md$/)
    .sort()
    .map((file) => ({ name: basename(file), text: readFileSync(file, "utf8") }));
}

/** `text` with LF line endings, rewritten as the given variant. */
export function variant(text: string, v: Variant): string {
  switch (v) {
    case "lf":
      return text;
    case "crlf":
      return text.replace(/\n/g, "\r\n");
    case "bom":
      return byteOrderMark + text;
    case "no-final-newline":
      return text.replace(/\n+$/, "");
  }
}

/** Every realistic fixture in every variant, named for test titles. */
export function realisticCases(): { name: string; text: string }[] {
  return fixtures("realistic").flatMap((f) =>
    variants.map((v) => ({ name: `${f.name} (${v})`, text: variant(f.text, v) })),
  );
}
