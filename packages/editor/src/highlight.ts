import { schema } from "@wysidown/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";
import type { Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

const lowlight = createLowlight({
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  powershell,
  python,
  ruby,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml,
});
lowlight.registerAlias({
  bash: ["sh", "shell", "zsh"],
  ini: ["toml"],
  javascript: ["jsx"],
  typescript: ["tsx"],
  xml: ["html"],
});

/** Code blocks longer than this many characters are shown plain. */
const longestHighlighted = 50_000;

interface Span {
  from: number;
  to: number;
  class: string;
}

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

function collect(node: HastNode, at: number, spans: Span[]): number {
  if (node.type === "text") return at + (node.value?.length ?? 0);
  const start = at;
  let end = at;
  for (const child of node.children ?? []) end = collect(child, end, spans);
  const name = node.properties?.className?.join(" ");
  if (name && end > start) spans.push({ from: start, to: end, class: name });
  return end;
}

const cache = new WeakMap<Node, Span[]>();

/** The highlighted spans of a code block, as offsets into its text; none for an unknown language. */
function spansOf(block: Node): Span[] {
  const known = cache.get(block);
  if (known) return known;
  const lang = ((block.attrs["lang"] as string | null) ?? "").toLowerCase();
  const spans: Span[] = [];
  if (lang !== "" && lowlight.registered(lang) && block.content.size <= longestHighlighted) {
    collect(lowlight.highlight(lang, block.textContent) as HastNode, 0, spans);
  }
  cache.set(block, spans);
  return spans;
}

/** Colours the tokens of code blocks by their language, as decorations only. */
export function highlighting(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type !== schema.nodes.code_block) return node.isBlock && !node.isTextblock;
          for (const span of spansOf(node)) {
            decorations.push(
              Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, { class: span.class }, { token: span.class }),
            );
          }
          return false;
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
