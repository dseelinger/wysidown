import type { Node } from "prosemirror-model";
import { TextSelection, type Command } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import { linkAt, setLink, targetOf, unlink, type LinkAt } from "../src/links.ts";
import { fixture } from "./support/corpus.ts";
import { Wire } from "./support/wire.ts";

const links = fixture("35-inline-links.md");
const references = fixture("09-reference-links.md");
const autolinks = fixture("10-autolinks.md");

/** The position just before the first occurrence of `find` in a textblock of `doc`. */
function before(doc: Node, find: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0 || !node.isTextblock) return found < 0;
    const at = node.textContent.indexOf(find);
    if (at >= 0) found = pos + 1 + at;
    return false;
  });
  if (found < 0) throw new Error(`"${find}" is not in the document`);
  return found;
}

/** Loads `text`, selects `find` (or puts the cursor before it), runs the command `build` makes, and returns the host's text. */
function run(text: string, find: string, build: (at: LinkAt | null) => Command, select = true): string {
  const wire = new Wire(text);
  wire.edit((s) => {
    const from = before(s.doc, find);
    return s.tr.setSelection(TextSelection.create(s.doc, from, select ? from + find.length : from));
  });
  const done = build(linkAt(wire.state))(wire.state, (tr) => {
    wire.session.update(wire.state.apply(tr));
  });
  expect(done).toBe(true);
  wire.drain();
  return wire.host.text;
}

describe("links are added, retargeted and removed in their own bytes", () => {
  test("the cursor in a link finds the whole link and its target", () => {
    const wire = new Wire(links);
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, before(s.doc, "and em"))));
    const at = linkAt(wire.state)!;
    expect(wire.state.doc.textBetween(at.from, at.to)).toBe("bold and em");
    expect(targetOf(wire.state.doc, at.mark)).toBe("https://example.com/format");
  });

  test("a new target replaces only the destination", () => {
    expect(run(links, "style", (at) => setLink(at, "style guide", "./docs/STYLE.md"), false)).toBe(
      links.replace("(./STYLE.md 'House style')", "(./docs/STYLE.md 'House style')"),
    );
  });

  test("new text and a new target together keep the title", () => {
    expect(run(links, "FAQ", (at) => setLink(at, "questions", "https://example.com/q"))).toBe(
      links.replace("[FAQ](https://example.com/faq ", "[questions](https://example.com/q "),
    );
  });

  test("a link added to selected text puts brackets around it", () => {
    expect(run(links, "setup", (at) => setLink(at, "setup", "https://example.com/setup"))).toBe(
      links.replace("for setup,", "for [setup](https://example.com/setup),"),
    );
  });

  test("a link added at the cursor is inserted with its text, or its target when it has none", () => {
    expect(run(links, "for setup", (at) => setLink(at, "guide", "https://example.com/g"), false)).toBe(
      links.replace("for setup", "[guide](https://example.com/g)for setup"),
    );
    expect(run(links, "for setup", (at) => setLink(at, "", "https://example.com/g"), false)).toBe(
      links.replace("for setup", "<https://example.com/g>for setup"),
    );
  });

  test("a reference link's new target is written in its definition", () => {
    expect(run(references, "guide, the", (at) => setLink(at, "guide", "https://example.org/guide"), false)).toBe(
      references.replace(
        '[guide]: https://example.com/guide "The Guide"',
        '[guide]: https://example.org/guide "The Guide"',
      ),
    );
  });

  test("an autolink's text follows its new target", () => {
    expect(
      run(
        autolinks,
        "https://example.com and",
        (at) => setLink(at, "https://example.com", "https://example.org"),
        false,
      ),
    ).toBe(autolinks.replace("<https://example.com>", "<https://example.org>"));
  });

  test("Remove, or an empty target, takes the link off and keeps its text as written", () => {
    expect(run(links, "the docs", (at) => unlink(at!), false)).toBe(
      links.replace("[the docs](https://example.com/docs)", "the docs"),
    );
    expect(run(links, "the docs", (at) => setLink(at, "the docs", " "), false)).toBe(
      links.replace("[the docs](https://example.com/docs)", "the docs"),
    );
  });
});
