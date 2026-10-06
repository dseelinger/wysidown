import type { Node } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../src/markdown/parse.ts";
import { schema } from "../src/markdown/schema.ts";
import { serializeMarkdown } from "../src/markdown/serialize.ts";
import { fixtures } from "./support/corpus.ts";

const fenced = fixtures("realistic").find((f) => f.name === "07-code-fenced.md")!.text;
const tabs = fixtures("realistic").find((f) => f.name === "24-tabs.md")!.text;
const containers = fixtures("realistic").find((f) => f.name === "34-code-in-containers.md")!.text;

/** The position of the code block whose text contains `text`. */
function codeAt(doc: Node, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === "code_block" && node.textContent.includes(text)) found = pos;
    return found < 0 && !node.isTextblock;
  });
  if (found < 0) throw new Error(`no code block holds "${text}"`);
  return found;
}

/** Saves `input` after replacing the text of the code block holding `old` with `text`. */
function retyped(input: string, old: string, text: string): string {
  return save(input, (tr) => {
    const pos = codeAt(tr.doc, old);
    const node = tr.doc.nodeAt(pos)!;
    return tr.replaceWith(pos + 1, pos + 1 + node.content.size, text === "" ? [] : schema.text(text));
  });
}

/** Saves `input` after giving the code block holding `old` the language `lang`. */
function relabelled(input: string, old: string, lang: string | null): string {
  return save(input, (tr) => {
    const pos = codeAt(tr.doc, old);
    return tr.setNodeMarkup(pos, null, { ...tr.doc.nodeAt(pos)!.attrs, lang });
  });
}

function save(input: string, edit: (tr: Transform) => Transform): string {
  const source = parseMarkdown(input);
  const result = serializeMarkdown(source, edit(new Transform(source.doc)).doc);
  expect(result.verified).toBe(true);
  return result.text;
}

describe("code block edits keep their fences and info string", () => {
  test("a changed line keeps a tilde fence and its info string, and the other lines as written", () => {
    const output = retyped(fenced, "def greet", 'def greet(name):\n    return f"Hi, {name}"');
    expect(output).toBe(fenced.replace('"Hello, {name}"', '"Hi, {name}"'));
  });

  test("lines added and removed inside a four-backtick fence leave its inner fence alone", () => {
    const old = 'Here is a fence inside a fence:\n\n```js\nconsole.log("nested");\n```';
    const now = 'Here is a fence inside a fence:\n\n```js\nconsole.log("nested");\nconsole.log("again");\n```';
    expect(retyped(fenced, "inside a fence", now)).toBe(
      fenced.replace('console.log("nested");\n', 'console.log("nested");\nconsole.log("again");\n'),
    );
    expect(retyped(fenced, "inside a fence", old.replace("\n\n```js", "\n```js"))).toBe(
      fenced.replace("fence:\n\n```js", "fence:\n```js"),
    );
  });

  test("a new language replaces only the language, keeping the rest of the info string", () => {
    expect(relabelled(fenced, "def greet", "py")).toBe(
      fenced.replace('~~~python title="example.py"', '~~~py title="example.py"'),
    );
    expect(relabelled(fenced, "no info string", "text")).toBe(fenced.replace("```\nno info", "```text\nno info"));
    expect(relabelled(fenced, "removed line", null)).toBe(fenced.replace("```diff", "```"));
  });

  test("an indented block given a language is written fenced where it stands", () => {
    expect(relabelled(containers, "pnpm test", "sh")).toBe(
      containers.replace("       pnpm test\n       pnpm lint\n", "   ```sh\n   pnpm test\n   pnpm lint\n   ```\n"),
    );
  });

  test("lines added in a quote or a list item take the prefix of the lines beside them", () => {
    expect(retyped(containers, "git log", "git log --oneline\n\ngit status\n\ngit diff")).toBe(
      containers.replace("> git status\n", "> git status\n>\n> git diff\n"),
    );
    expect(retyped(containers, "key: value", "key: value\nother: 1")).toBe(
      containers.replace("    key: value\n", "    key: value\n    other: 1\n"),
    );
    expect(retyped(containers, "pnpm test", "pnpm test\npnpm lint\npnpm build")).toBe(
      containers.replace("       pnpm lint\n", "       pnpm lint\n       pnpm build\n"),
    );
  });

  test("text typed into an empty fence goes between its fences", () => {
    const empty = "  ```\n  ```\n";
    expect(containers).toContain(empty);
    const output = save(containers, (tr) => {
      let pos = -1;
      tr.doc.descendants((node, at) => {
        if (node.type.name === "code_block" && node.content.size === 0) pos = at;
        return !node.isTextblock;
      });
      return tr.insert(pos + 1, schema.text("echo"));
    });
    expect(output).toBe(containers.replace(empty, "  ```\n  echo\n  ```\n"));
  });

  test("tabs typed into code are saved as tabs, in fenced and indented blocks", () => {
    expect(retyped(tabs, "tab in a fence", 'all:\n\techo "tab in a fence"\n\t\tdone')).toBe(
      tabs.replace('\techo "tab in a fence"\n', '\techo "tab in a fence"\n\t\tdone\n'),
    );
    const indented = "Text.\n\n\tfirst line\n\tsecond line\n";
    expect(retyped(indented, "first line", "first line\n\tsecond line")).toBe(
      "Text.\n\n\tfirst line\n\t\tsecond line\n",
    );
  });

  test("a typed line that would close the fence is saved inside a longer fence", () => {
    const output = retyped(fenced, "no info string", "no info string\n```");
    expect(parseMarkdown(output).doc.child(4).textContent).toBe("no info string\n```");
    const at = fenced.indexOf("```\nno info string");
    expect(output.slice(0, at)).toBe(fenced.slice(0, at));
  });

  test("a typed line that looks like a fence but is indented four spaces keeps the block's fence", () => {
    expect(retyped(fenced, "def greet", 'def greet(name):\n    return f"Hello, {name}"\n    ~~~')).toBe(
      fenced.replace('{name}"\n~~~', '{name}"\n    ~~~\n~~~'),
    );
  });

  test("a code block in a CRLF file keeps CRLF on its new lines", () => {
    const crlf = fenced.replace(/\n/g, "\r\n");
    expect(retyped(crlf, "no info string", "no info string\nmore")).toBe(
      crlf.replace("no info string\r\n", "no info string\r\nmore\r\n"),
    );
  });
});
