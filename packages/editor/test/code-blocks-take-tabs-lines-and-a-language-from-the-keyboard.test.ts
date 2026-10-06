import type { Node } from "prosemirror-model";
import { TextSelection, type Command } from "prosemirror-state";
import { describe, expect, test } from "vitest";
import { codeKeys, indentCode, outdentCode, setLanguage } from "../src/code.ts";
import { Wire } from "./support/wire.ts";

const text = 'Intro.\n\n~~~python title="a.py"\ndef f():\n    return 1\n~~~\n\n- Item:\n\n  ```\n  one\n  ```\n';

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

/** The position of the code block holding `find`. */
function blockOf(doc: Node, find: string): number {
  return doc.resolve(after(doc, find)).before();
}

/** Loads `text`, selects from the end of `from` to the end of `to`, runs `command`, and returns the host's text. */
function run(command: Command, from: string, to = from): string {
  const wire = new Wire(text);
  wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, after(s.doc, from), after(s.doc, to))));
  expect(
    command(wire.state, (tr) => {
      wire.session.update(wire.state.apply(tr));
    }),
  ).toBe(true);
  wire.drain();
  return wire.host.text;
}

describe("code blocks take tabs, lines and a language from the keyboard", () => {
  test("Tab in a code block types a tab, which is saved as a tab", () => {
    expect(run(indentCode, "def f():\n")).toBe(text.replace("\n    return 1", "\n\t    return 1"));
  });

  test("Tab and Shift-Tab with lines selected indent and outdent every line", () => {
    const indented = run(indentCode, "def", "return");
    expect(indented).toBe(text.replace("def f():\n    return 1", "\tdef f():\n\t    return 1"));
    const wire = new Wire(indented);
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, after(s.doc, "def"), after(s.doc, "return"))));
    outdentCode(wire.state, (tr) => {
      wire.session.update(wire.state.apply(tr));
    });
    wire.drain();
    expect(wire.host.text).toBe(text);
  });

  test("Tab with whole lines selected leaves the line after the selection alone", () => {
    const wire = new Wire(text);
    const start = after(wire.state.doc, "def f():\n") - "def f():\n".length;
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, start, after(s.doc, "def f():\n"))));
    indentCode(wire.state, (tr) => {
      wire.session.update(wire.state.apply(tr));
    });
    wire.drain();
    expect(wire.host.text).toBe(text.replace("def f():", "\tdef f():"));
  });

  test("Tab outside a code block is left to the list and table keys", () => {
    const wire = new Wire(text);
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, after(s.doc, "Item"))));
    expect(codeKeys["Tab"]!(wire.state)).toBe(false);
    expect(codeKeys["Shift-Tab"]!(wire.state)).toBe(false);
  });

  test("Enter in a code block inside a list item starts a new line of code, not a new item", () => {
    const wire = new Wire(text);
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, after(s.doc, "one"))));
    codeKeys["Enter"]!(wire.state, (tr) => {
      wire.session.update(wire.state.apply(tr));
    });
    wire.edit((s) => s.tr.insertText("two"));
    wire.drain();
    expect(wire.host.text).toBe(text.replace("  one\n", "  one\n  two\n"));
  });

  test("a language set from the picker changes only the info string, and a blank one removes it", () => {
    const wire = new Wire(text);
    const set = (find: string, lang: string) => {
      expect(
        setLanguage(blockOf(wire.state.doc, find), lang)(wire.state, (tr) => {
          wire.session.update(wire.state.apply(tr));
        }),
      ).toBe(true);
      wire.drain();
    };
    set("def f", "py");
    expect(wire.host.text).toBe(text.replace('~~~python title="a.py"', '~~~py title="a.py"'));
    set("one", "  text  ");
    expect(wire.host.text).toBe(
      text.replace('~~~python title="a.py"', '~~~py title="a.py"').replace("```\n  one", "```text\n  one"),
    );
    set("def f", "");
    expect(wire.host.text).toBe(text.replace('~~~python title="a.py"', "~~~").replace("```\n  one", "```text\n  one"));
  });
});
