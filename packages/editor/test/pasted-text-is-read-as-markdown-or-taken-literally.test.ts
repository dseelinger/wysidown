import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import { markdownSlice, plainSlice } from "../src/paste.ts";
import { fixture } from "./support/corpus.ts";
import { Wire } from "./support/wire.ts";

const post = fixture("27-blog-post.md");

/** The position just after the first occurrence of `find` in a textblock of `doc`. */
function after(doc: Node, find: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0 || !node.isTextblock) return found < 0;
    const at = node.textContent.indexOf(find);
    if (at >= 0) found = pos + 1 + at + find.length;
    return false;
  });
  if (found < 0) throw new Error(`"${find}" is not in the document`);
  return found;
}

/** Loads `text`, pastes `slice` just after `find`, and returns the host's text. */
function pasted(text: string, find: string, slice: ReturnType<typeof plainSlice>): string {
  const wire = new Wire(text);
  wire.edit((s) => {
    const at = after(s.doc, find);
    return s.tr.setSelection(TextSelection.create(s.doc, at)).replaceSelection(slice);
  });
  wire.drain();
  return wire.host.text;
}

describe("pasted text is read as markdown or taken literally", () => {
  test("markdown inside a paragraph keeps its emphasis and links as written", () => {
    expect(
      pasted(post, "That makes review painful.", markdownSlice(" It is *slow* and [costly](https://example.com).")),
    ).toBe(
      post.replace(
        "That makes review painful.",
        "That makes review painful. It is *slow* and [costly](https://example.com).",
      ),
    );
  });

  test("markdown blocks pasted at the end of a paragraph become blocks after it", () => {
    const result = pasted(post, "a one-word diff.", markdownSlice("\n\n## Pasted\n\n- one\n- two\n"));
    expect(result).toBe(post.replace("a one-word diff.\n", "a one-word diff.\n\n## Pasted\n\n- one\n- two\n"));
  });

  test("markdown copied with CRLF line endings pastes as the same blocks", () => {
    expect(pasted(post, "a one-word diff.", markdownSlice("\r\n\r\n## Pasted\r\n\r\n- one\r\n- two\r\n"))).toBe(
      pasted(post, "a one-word diff.", markdownSlice("\n\n## Pasted\n\n- one\n- two\n")),
    );
  });

  test("a thematic break at the start of pasted markdown is not read as front matter", () => {
    const slice = markdownSlice("---\ntitle: x\n---\n");
    expect(slice.content.firstChild?.type.name).toBe("thematic_break");
  });

  test("literal text keeps its markdown characters as text", () => {
    const result = pasted(post, "That makes review painful.", plainSlice(" Use *stars* and # signs."));
    expect(result).toBe(
      post.replace("That makes review painful.", "That makes review painful. Use \\*stars\\* and # signs."),
    );
  });

  test("literal text splits into paragraphs at blank lines", () => {
    const slice = plainSlice("first line\nsecond line\r\n\r\nnext paragraph\n");
    expect(slice.content.childCount).toBe(2);
    expect(slice.content.child(0).textContent).toBe("first line\nsecond line");
    expect(slice.content.child(1).textContent).toBe("next paragraph");
  });
});
