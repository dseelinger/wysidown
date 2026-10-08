import { parseMarkdown, type MarkdownSource } from "@wysidown/core";
import { baseKeymap } from "prosemirror-commands";
import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import { splitItem } from "../src/lists.ts";
import { convertLine, typedSyntaxPlugins, undoConversion } from "../src/typed-syntax.ts";
import { realisticCases } from "./support/corpus.ts";
import { press, type } from "./support/typing.ts";
import { Wire } from "./support/wire.ts";

/** The position after the first occurrence of `find` in a textblock of `doc`, or before it when `before`. */
function at(doc: Node, find: string, before = false): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0 || !node.isTextblock) return found < 0;
    const k = node.textContent.indexOf(find);
    if (k >= 0) found = pos + 1 + (before ? k : k + find.length);
    return false;
  });
  if (found < 0) throw new Error(`"${find}" is not in the document`);
  return found;
}

/** Puts the cursor after `find`, or before it when `before`. */
function moveTo(wire: Wire, find: string, before = false): void {
  wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, at(s.doc, find, before))));
}

/** A wire on `text` with the cursor after `find`, or before it when `before`. */
function wireAt(text: string, find: string, before = false, hold = 0): Wire {
  const wire = new Wire(text, hold, typedSyntaxPlugins);
  moveTo(wire, find, before);
  return wire;
}

/** Presses Enter, as the editor's keymaps would handle it. */
function enter(wire: Wire): void {
  if (!press(wire, convertLine) && !press(wire, splitItem)) press(wire, baseKeymap["Enter"]!);
}

/** Loads `text`, types `typed` before `find`, and returns the host's text. */
function typedBefore(text: string, find: string, typed: string): string {
  const wire = wireAt(text, find, true);
  type(wire, typed);
  wire.drain();
  return wire.host.text;
}

/** Loads `text`, types `typed` after `find`, and returns the wire once the host has the edit. */
function typedAfter(text: string, find: string, typed: string): Wire {
  const wire = wireAt(text, find);
  type(wire, typed);
  wire.drain();
  return wire;
}

/** The names of the marks on the text node that is exactly `find`. */
function marksOn(doc: Node, find: string): string[] | null {
  let names: string[] | null = null;
  doc.descendants((node) => {
    if (names === null && node.isText && node.text === find) names = node.marks.map((m) => m.type.name);
    return names === null;
  });
  return names;
}

const text = "Intro.\n\nSecond paragraph.\n";

describe("markdown syntax typed at the start of a paragraph becomes a block", () => {
  test.each([
    ["# ", "# Second paragraph.\n"],
    ["### ", "### Second paragraph.\n"],
    ["###### ", "###### Second paragraph.\n"],
    ["- ", "- Second paragraph.\n"],
    ["1. ", "1. Second paragraph.\n"],
    ["3) ", "3. Second paragraph.\n"],
    ["- [ ] ", "- [ ] Second paragraph.\n"],
    ["- [x] ", "- [x] Second paragraph.\n"],
    ["1. [ ] ", "1. [ ] Second paragraph.\n"],
    ["> ", "> Second paragraph.\n"],
  ])("%j", (typed, saved) => {
    expect(typedBefore(text, "Second", typed)).toBe("Intro.\n\n" + saved);
  });

  test("a bullet list takes the document's bullet marker, whichever was typed", () => {
    expect(typedBefore(text, "Second", "* ")).toBe("Intro.\n\n- Second paragraph.\n");
    expect(typedBefore("* a\n* b\n\nIntro.\n\nSecond.\n", "Second", "+ ")).toBe("* a\n* b\n\nIntro.\n\n* Second.\n");
  });

  test("seven hashes, a hash with no space, and syntax after other text stay as text", () => {
    expect(typedBefore(text, "Second", "####### ")).toBe("Intro.\n\n####### Second paragraph.\n");
    expect(typedBefore(text, "Second", "#x")).toBe("Intro.\n\n#xSecond paragraph.\n");
    expect(typedAfter(text, "Second", " - ").host.text).toBe("Intro.\n\nSecond -  paragraph.\n");
  });

  test("syntax typed at the start of a heading stays as text", () => {
    expect(typedBefore("# Title\n", "Title", "- ")).toBe("# - Title\n");
  });

  test("a list typed straight after a list of its kind joins it, in that list's style", () => {
    expect(typedBefore("* one\n* two\n\nOutro.\n", "Outro", "- ")).toBe("* one\n* two\n* Outro.\n");
    expect(typedBefore("- one\n\n- two\n\nOutro.\n", "Outro", "- ")).toBe("- one\n\n- two\n\n- Outro.\n");
    expect(typedBefore("1. one\n2. two\n\nOutro.\n", "Outro", "1. ")).toBe("1. one\n2. two\n3. Outro.\n");
  });

  test("a list typed straight before a list of its kind joins it as its first item", () => {
    expect(typedBefore("Intro:\n\n- one\n- two\n", "Intro", "- ")).toBe("- Intro:\n- one\n- two\n");
    expect(typedBefore("Intro:\n\n- one\n\n- two\n", "Intro", "- ")).toBe("- Intro:\n\n- one\n\n- two\n");
  });

  test("a list next to a list of the other kind, and a quote next to a quote, stay apart", () => {
    expect(typedBefore("1. a\n2. b\n\nPara.\n", "Para", "- ")).toBe("1. a\n2. b\n\n- Para.\n");
    expect(typedBefore("> a\n\nPara.\n", "Para", "> ")).toBe("> a\n\n> Para.\n");
  });

  test("[ ] at the start of a task's text, or of an item's second paragraph, stays as text", () => {
    const wire = wireAt("- [ ] task\n- plain\n\n  more\n", "task", true);
    type(wire, "[x] ");
    moveTo(wire, "more", true);
    type(wire, "[ ] ");
    wire.drain();
    expect(wire.host.text).toBe("- [ ] \\[x\\] task\n- plain\n\n  \\[ \\] more\n");
  });

  test("a heading, list or quote typed at the start of a task's text stays as text", () => {
    for (const typed of ["## ", "- ", "> "]) {
      const wire = wireAt("- [ ] task\n", "task", true);
      type(wire, typed);
      expect(wire.state.doc.child(0).child(0).child(0).type.name).toBe("paragraph");
    }
  });
});

describe("markdown syntax typed around text becomes formatting when the closing marker is typed", () => {
  test.each([
    ["**bold**", "**bold**", "strong"],
    ["__bold__", "**bold**", "strong"],
    ["*italic*", "*italic*", "em"],
    ["_italic_", "*italic*", "em"],
    ["`code`", "`code`", "code"],
    ["~~struck~~", "~~struck~~", "strike"],
  ])("%j", (typed, saved, mark) => {
    const wire = typedAfter(text, "Second ", typed);
    expect(wire.host.text).toBe(`Intro.\n\nSecond ${saved}paragraph.\n`);
    expect(marksOn(wire.state.doc, typed.replace(/[*_`~]/g, ""))).toEqual([mark]);
  });

  test("text typed after the closing marker is not formatted", () => {
    const wire = typedAfter(text, "Second ", "**bold** after");
    expect(wire.host.text).toBe("Intro.\n\nSecond **bold** afterparagraph.\n");
    expect(marksOn(wire.state.doc, " afterparagraph.")).toEqual([]);
  });

  test("underscores inside a word, spaced asterisks and empty markers stay as text", () => {
    const wire = typedAfter(text, "Second ", "snake_case_name 2 * 3 * 4 ** ``");
    expect(marksOn(wire.state.doc, "Second snake_case_name 2 * 3 * 4 ** ``paragraph.")).toEqual([]);
  });
});

describe("Enter on a line of its own that holds a fence or a rule", () => {
  test.each([
    ["```", "```\nx\n```\n"],
    ["```js", "```js\nx\n```\n"],
    ["~~~ python title", "```python title\nx\n```\n"],
    ["---", "---\n\nx\n"],
    ["***", "---\n\nx\n"],
    ["___", "---\n\nx\n"],
  ])("%j", (typed, saved) => {
    const wire = wireAt(text, "Intro.");
    enter(wire);
    type(wire, typed);
    enter(wire);
    type(wire, "x");
    wire.drain();
    expect(wire.host.text).toBe("Intro.\n\n" + saved + "\nSecond paragraph.\n");
  });

  test("a rule on the first line of a list item is left to Enter, as markdown reads it as a rule alone", () => {
    const wire = wireAt("- one\n", "one");
    enter(wire);
    type(wire, "---");
    expect(press(wire, convertLine)).toBe(false);
  });

  test("a rule or fence already in the file, and four fence characters, are left to Enter", () => {
    expect(press(wireAt("Intro.\n\n\\---\n", "---"), convertLine)).toBe(false);
    expect(press(wireAt("Intro.\n\n\\`\\`\\`\n", "```"), convertLine)).toBe(false);
    const wire = wireAt(text, "Intro.");
    enter(wire);
    type(wire, "~~~~");
    expect(press(wire, convertLine)).toBe(false);
  });

  test("Enter after Backspace has taken a rule back keeps the dashes and adds a paragraph", () => {
    const wire = wireAt(text, "Intro.");
    enter(wire);
    type(wire, "---");
    enter(wire);
    press(wire, undoConversion);
    enter(wire);
    type(wire, "x");
    wire.drain();
    expect(wire.host.text).toBe("Intro.\n\n\\---\n\nx\n\nSecond paragraph.\n");
  });

  test("a fence after other text, or with the cursor before its end, is left to Enter", () => {
    expect(press(wireAt("Text ```\n", "```"), convertLine)).toBe(false);
    const wire = wireAt(text, "Intro.");
    enter(wire);
    type(wire, "```js");
    moveTo(wire, "js", true);
    expect(press(wire, convertLine)).toBe(false);
  });
});

describe("Backspace straight after a conversion undoes it and leaves the typed characters", () => {
  test.each(["# ", "- ", "1. ", "> "])("%j", (typed) => {
    const wire = wireAt(text, "Second", true);
    type(wire, typed);
    expect(press(wire, undoConversion)).toBe(true);
    wire.drain();
    expect(wire.state.doc.child(1).type.name).toBe("paragraph");
    expect(wire.state.doc.child(1).textContent).toBe(typed + "Second paragraph.");
    expect(parseMarkdown(wire.host.text).doc.toJSON()).toEqual(wire.state.doc.toJSON());
  });

  test.each(["**bold**", "_italic_", "`code`", "~~struck~~"])("%j", (typed) => {
    const wire = wireAt(text, "Second ");
    type(wire, typed);
    expect(press(wire, undoConversion)).toBe(true);
    wire.drain();
    expect(marksOn(wire.state.doc, `Second ${typed}paragraph.`)).toEqual([]);
    expect(parseMarkdown(wire.host.text).doc.toJSON()).toEqual(wire.state.doc.toJSON());
  });

  test.each(["```js", "---"])("%j and Enter", (typed) => {
    const wire = wireAt(text, "Intro.");
    enter(wire);
    type(wire, typed);
    enter(wire);
    expect(press(wire, undoConversion)).toBe(true);
    wire.drain();
    expect(wire.state.doc.child(1).textContent).toBe(typed);
    expect(wire.state.selection.from).toBe(at(wire.state.doc, typed));
  });

  test("Backspace after typing more is left to delete a character", () => {
    const wire = wireAt(text, "Second", true);
    type(wire, "# x");
    expect(press(wire, undoConversion)).toBe(false);
  });

  test("a conversion and its undo reach a host that owns undo while typing is held", () => {
    const wire = wireAt(text, "Second", true, 1000);
    type(wire, "# ");
    wire.drain();
    expect(wire.host.text).toBe("Intro.\n\n# Second paragraph.\n");
    press(wire, undoConversion);
    wire.drain();
    expect(wire.host.text).toBe("Intro.\n\n\\# Second paragraph.\n");
  });
});

describe("nothing converts in code", () => {
  test("in a code block", () => {
    const wire = typedAfter("```\ncode\n```\n", "code", " **x** # ");
    expect(wire.host.text).toBe("```\ncode **x** # \n```\n");
    moveTo(wire, "code", true);
    type(wire, "- ");
    enter(wire);
    expect(wire.state.doc.child(0).type.name).toBe("code_block");
  });

  test("in inline code", () => {
    expect(typedAfter("Use `a` here.\n", "a", " *b*").host.text).toBe("Use `a *b*` here.\n");
  });
});

/** The ways a conversion is typed: at the start of a paragraph, at its end, or on a new line after it. */
const conversions: { name: string; atEnd: boolean; enter: boolean; run: (wire: Wire) => void }[] = [
  ...["## ", "- ", "1. ", "> "].map((typed) => ({
    name: typed,
    atEnd: false,
    enter: false,
    run: (w: Wire) => {
      type(w, typed);
    },
  })),
  ...[" **bold**", " _italic_", " `code`", " ~~struck~~"].map((typed) => ({
    name: typed.trim(),
    atEnd: true,
    enter: false,
    run: (w: Wire) => {
      type(w, typed);
    },
  })),
  ...["```js", "---"].map((typed) => ({
    name: typed,
    atEnd: true,
    enter: true,
    run: (w: Wire) => {
      enter(w);
      type(w, typed);
      enter(w);
      type(w, "x");
    },
  })),
];

/** True for a list, or a code block not written with a fence, which a list beside it can take in. */
const merges = (source: MarkdownSource, node: Node | null) =>
  node?.type.name === "list" ||
  (node?.type.name === "code_block" && !/^ *(?:```|~~~)/.test(source.text.slice(source.ranges.get(node)!.start)));

describe("a conversion typed into the realistic corpus changes only its own block", () => {
  test.each(realisticCases())("$name", ({ name, text }) => {
    const source = parseMarkdown(text);
    const targets: { node: Node; pos: number; inItem: boolean }[] = [];
    source.doc.descendants((node, pos, parent, k) => {
      if (targets.length > 0) return false;
      if (node.type.name !== "paragraph" || node.childCount === 0 || !parent) return true;
      const around = [k > 0 ? parent.child(k - 1) : null, k + 1 < parent.childCount ? parent.child(k + 1) : null];
      const task = parent.type.name === "list_item" && k === 0 && parent.attrs["checked"] !== null;
      if (!task && !around.some((n) => merges(source, n)))
        targets.push({ node, pos, inItem: parent.type.name === "list_item" });
      return false;
    });
    const target = targets[0];
    if (!target) {
      expect(name, "the only document with no paragraph to type into").toMatch(/^07-code-fenced\.md /);
      return;
    }
    const { node, pos, inItem } = target;
    const range = source.ranges.get(node)!;
    const shift = source.bom ? 1 : 0;
    // Enter in a list item adds an item; the fence and the rule are typed into it as list items test.
    for (const conversion of conversions.filter((c) => !(inItem && c.enter))) {
      const wire = new Wire(text, 0, typedSyntaxPlugins);
      const cursor = pos + (conversion.atEnd ? node.nodeSize - 1 : 1);
      wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, cursor)));
      conversion.run(wire);
      wire.drain();
      const saved = wire.host.text;
      expect(saved, conversion.name).not.toBe(text);
      expect(saved.slice(0, range.start + shift), conversion.name).toBe(text.slice(0, range.start + shift));
      expect(saved.slice(saved.length - text.length + range.end + shift), conversion.name).toBe(
        text.slice(range.end + shift),
      );
      expect(parseMarkdown(saved).doc.toJSON(), conversion.name).toEqual(wire.state.doc.toJSON());
    }
  });
});
