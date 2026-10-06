import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";

export function parseMdast(src: string) {
  return fromMarkdown(src, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

export const mdast = {
  name: "mdast",
  roundTrip(src: string): string {
    return toMarkdown(parseMdast(src), { extensions: [gfmToMarkdown()] });
  },
};
