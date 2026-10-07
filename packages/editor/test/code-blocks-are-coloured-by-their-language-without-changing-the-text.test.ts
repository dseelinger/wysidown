import type { EditorState } from "prosemirror-state";
import { DecorationSet } from "prosemirror-view";
import { describe, expect, test } from "vitest";
import { highlighting } from "../src/highlight.ts";
import { Wire } from "./support/wire.ts";

/** The highlighted pieces of the document: the text each decoration covers and its class. */
function pieces(state: EditorState): [string, string][] {
  const plugin = highlighting();
  const set = plugin.props.decorations?.call(plugin, state) as DecorationSet;
  return set.find().map((d) => [state.doc.textBetween(d.from, d.to), (d.spec as { token: string }).token]);
}

function decorationClass(state: EditorState, word: string): string | undefined {
  return pieces(state).find(([text]) => text === word)?.[1];
}

describe("code blocks are coloured by their language without changing the text", () => {
  test("keywords, strings and numbers of a known language are marked", () => {
    const state = new Wire('```js\nconst n = 42; // x\nlet s = "a";\n```\n').state;
    expect(decorationClass(state, "const")).toBe("hljs-keyword");
    expect(decorationClass(state, "42")).toBe("hljs-number");
    expect(decorationClass(state, '"a"')).toBe("hljs-string");
    expect(decorationClass(state, "// x")).toBe("hljs-comment");
  });

  test("the language names in the picker's suggestions and their aliases are known", () => {
    for (const lang of ["ts", "tsx", "jsx", "sh", "html", "toml", "yaml", "json", "cpp", "csharp", "diff"]) {
      const state = new Wire("```" + lang + "\nfoo 1\n```\n").state;
      expect(() => pieces(state)).not.toThrow();
    }
    expect(pieces(new Wire("```sh\nif true; then echo hi; fi\n```\n").state).length).toBeGreaterThan(0);
    expect(pieces(new Wire('```toml\nname = "x"\n```\n').state).length).toBeGreaterThan(0);
  });

  test("a block with no language, an unknown language or mermaid stays plain", () => {
    for (const info of ["", "klingon", "mermaid"]) {
      expect(pieces(new Wire("```" + info + "\nconst n = 42;\n```\n").state)).toEqual([]);
    }
  });

  test("code outside a code block is not marked", () => {
    expect(pieces(new Wire("const n = 42;\n\n- `let`\n").state)).toEqual([]);
  });

  test("highlighting does not change the saved bytes", () => {
    const text = '```python\ndef f():\n    return "x"\n```\n';
    const wire = new Wire(text);
    pieces(wire.state);
    wire.drain();
    expect(wire.host.text).toBe(text);
  });
});
