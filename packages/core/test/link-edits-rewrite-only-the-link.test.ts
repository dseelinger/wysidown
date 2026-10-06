import type { Mark, Node } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import { describe, expect, test } from "vitest";
import { definitionTarget, retargetDefinition } from "../src/markdown/links.ts";
import { parseMarkdown } from "../src/markdown/parse.ts";
import { schema } from "../src/markdown/schema.ts";
import { serializeMarkdown } from "../src/markdown/serialize.ts";
import { fixtures } from "./support/corpus.ts";
import { editCases } from "./support/edits.ts";

const links = fixtures("realistic").find((f) => f.name === "35-inline-links.md")!.text;
const autolinks = fixtures("realistic").find((f) => f.name === "10-autolinks.md")!.text;
const references = fixtures("realistic").find((f) => f.name === "09-reference-links.md")!.text;

/** The positions of the first stretch of `text` in `doc`, which must lie in one text node. */
function find(doc: Node, text: string): { from: number; to: number; marks: readonly Mark[] } {
  const found: { from: number; to: number; marks: readonly Mark[] }[] = [];
  doc.descendants((node, pos) => {
    const at = found.length > 0 || !node.isText ? -1 : node.text!.indexOf(text);
    if (at >= 0) found.push({ from: pos + at, to: pos + at + text.length, marks: node.marks });
    return found.length === 0;
  });
  if (!found[0]) throw new Error(`no text node holds "${text}"`);
  return found[0];
}

function save(input: string, edit: (tr: Transform) => Transform): { text: string; step: string } {
  const source = parseMarkdown(input);
  const result = serializeMarkdown(source, edit(new Transform(source.doc)).doc);
  expect(result.verified).toBe(true);
  return result;
}

/** The positions of the whole link whose text holds `text`. */
function linkAround(doc: Node, text: string): { from: number; to: number } {
  const at = find(doc, text);
  const link = at.marks.find((m) => m.type === schema.marks.link)!;
  const $at = doc.resolve(at.from);
  let run: { from: number; to: number } | null = null;
  let found: { from: number; to: number } | null = null;
  $at.parent.forEach((child, offset) => {
    const start = $at.start() + offset;
    run = link.isInSet(child.marks) ? { from: run?.from ?? start, to: start + child.nodeSize } : null;
    if (run && run.from <= at.from && at.from < run.to) found = run;
  });
  return found!;
}

/** Saves `input` with the link whose text holds `text` given `attrs`. */
function retargeted(input: string, text: string, attrs: Record<string, unknown>): string {
  return save(input, (tr) => {
    const { from, to } = linkAround(tr.doc, text);
    return tr.addMark(from, to, schema.marks.link.create(attrs));
  }).text;
}

/** Saves `input` with the text `text` of a link replaced by `now`, under the link `attrs`. */
function rewritten(input: string, text: string, now: string, attrs: Record<string, unknown>): string {
  return save(input, (tr) => {
    const { from, to, marks } = find(tr.doc, text);
    const link = schema.marks.link.create(attrs);
    return tr.replaceWith(from, to, schema.text(now, link.addToSet(marks)));
  }).text;
}

describe("link edits rewrite only the link", () => {
  test("a new target replaces the destination alone, keeping the title as written", () => {
    expect(retargeted(links, "style guide", { href: "./docs/STYLE.md", title: "House style" })).toBe(
      links.replace("(./STYLE.md 'House style')", "(./docs/STYLE.md 'House style')"),
    );
    expect(retargeted(links, "notes", { href: "docs/notes.md" })).toBe(
      links.replace("(<docs/meeting notes.md>)", "(docs/notes.md)"),
    );
    expect(retargeted(links, "Markdown", { href: "https://commonmark.org" })).toBe(
      links.replace("(https://en.wikipedia.org/wiki/Markdown_(markup_language))", "(https://commonmark.org)"),
    );
    expect(retargeted(links, "nowhere", { href: "https://example.com/here" })).toBe(
      links.replace("[nowhere]()", "[nowhere](https://example.com/here)"),
    );
  });

  test("a target with a space is written in angle brackets", () => {
    expect(retargeted(links, "the docs", { href: "docs/set up.md" })).toBe(
      links.replace("(https://example.com/docs)", "(<docs/set up.md>)"),
    );
  });

  test("a link around formatted text keeps the formatting as written", () => {
    expect(retargeted(links, "bold", { href: "https://example.com/new" })).toBe(
      links.replace("(https://example.com/format)", "(https://example.com/new)"),
    );
  });

  test("a link added around a word keeps the word and the text around it as written", () => {
    const { text, step } = save(links, (tr) => {
      const { from, to } = find(tr.doc, "setup");
      return tr.addMark(from, to, schema.marks.link.create({ href: "https://example.com/setup" }));
    });
    expect(step).toBe("minimal");
    expect(text).toBe(links.replace("for setup,", "for [setup](https://example.com/setup),"));
  });

  test("a link typed in among text is written where it was typed, as an autolink when it shows its target", () => {
    const inserted = (text: string, href: string) =>
      save(links, (tr) => {
        const { from } = find(tr.doc, "for setup");
        return tr.insert(from, schema.text(text, [schema.marks.link.create({ href })]));
      });
    const named = inserted("guide", "https://example.com/g");
    expect(named.step).toBe("minimal");
    expect(named.text).toBe(links.replace("for setup", "[guide](https://example.com/g)for setup"));
    expect(inserted("https://example.com/g", "https://example.com/g").text).toBe(
      links.replace("for setup", "<https://example.com/g>for setup"),
    );
  });

  test("a link taken off its text leaves the text as written", () => {
    const { text } = save(links, (tr) => {
      const { from, to } = linkAround(tr.doc, "bold");
      return tr.removeMark(from, to, schema.marks.link);
    });
    expect(text).toBe(links.replace("[**bold** and *em*](https://example.com/format)", "**bold** and *em*"));
    const reference = save(references, (tr) => {
      const { from, to } = find(tr.doc, "guide");
      return tr.removeMark(from, to, schema.marks.link);
    });
    expect(reference.text).toBe(references.replace("the [guide][guide],", "the guide,"));
  });

  test("new text and a new target together keep the brackets and title as written", () => {
    expect(rewritten(links, "FAQ", "questions", { href: "https://example.com/q", title: "Frequently asked" })).toBe(
      links.replace(
        '[FAQ](https://example.com/faq "Frequently asked")',
        '[questions](https://example.com/q "Frequently asked")',
      ),
    );
  });

  test("an autolink whose text follows its new target stays an autolink", () => {
    expect(rewritten(autolinks, "https://example.com", "https://example.org", { href: "https://example.org" })).toBe(
      autolinks.replace("<https://example.com>", "<https://example.org>"),
    );
    expect(rewritten(autolinks, "www.example.com", "www.example.org", { href: "http://www.example.org" })).toBe(
      autolinks.replace("www.example.com,", "www.example.org,"),
    );
  });

  test("an autolink given a target with no scheme becomes an inline link showing it", () => {
    const { text, step } = save(autolinks, (tr) => {
      const { from, to, marks } = find(tr.doc, "https://example.com");
      const link = schema.marks.link.create({ href: "docs/page.md" });
      return tr.replaceWith(from, to, schema.text("docs/page.md", link.addToSet(marks)));
    });
    expect(step).toBe("minimal");
    expect(text).toBe(autolinks.replace("<https://example.com>", "[docs/page.md](docs/page.md)"));
  });

  test("an autolink given a target its text does not name becomes an inline link", () => {
    expect(retargeted(autolinks, "https://example.com", { href: "https://example.org" })).toBe(
      autolinks.replace("<https://example.com>", "[https://example.com](https://example.org)"),
    );
  });

  test("the corpus edits retarget, remove and add links across the realistic documents", () => {
    const counts = fixtures("realistic").map(({ text }) =>
      (["link target", "remove link", "add link"] as const).map((kind) => editCases(text, kind).length),
    );
    const [target, remove, add] = [0, 1, 2].map((k) => counts.reduce((sum, c) => sum + c[k]!, 0));
    expect(target).toBeGreaterThan(40);
    expect(remove).toBe(target);
    expect(add).toBeGreaterThan(100);
  });
});

describe("a link definition can be given a new target", () => {
  test("the label, spacing and title stay as written", () => {
    expect(
      retargetDefinition("[the faq]: <https://example.com/faq> 'Frequently asked'", "https://example.org/faq"),
    ).toBe("[the faq]: https://example.org/faq 'Frequently asked'");
    expect(retargetDefinition("[logo-img]: ./images/logo.png (Logo)", "./img/logo 2.png")).toBe(
      "[logo-img]: <./img/logo 2.png> (Logo)",
    );
    expect(retargetDefinition("[guide]:\n  https://example.com/guide", "https://example.com/g")).toBe(
      "[guide]:\n  https://example.com/g",
    );
  });

  test("its target and title are read from its source", () => {
    expect(definitionTarget('[guide]: https://example.com/guide "The Guide"')).toEqual({
      href: "https://example.com/guide",
      title: "The Guide",
    });
    expect(definitionTarget("Not a definition")).toBeNull();
    expect(retargetDefinition("Not a definition", "https://example.com")).toBeNull();
  });
});
