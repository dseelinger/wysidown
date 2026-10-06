import { schema } from "@wysidown/core";
import {
  DOMParser,
  DOMSerializer,
  type DOMOutputSpec,
  type Mark,
  type Node,
  type ParseOptions,
} from "prosemirror-model";
import type { MarkViewConstructor, NodeViewConstructor } from "prosemirror-view";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** How each node type is shown. Raw syntax and images show their source text, read-only. */
const nodes: Record<string, (node: Node) => DOMOutputSpec> = {
  paragraph: () => ["p", 0],
  heading: (n) => [`h${String(n.attrs["level"])}`, 0],
  blockquote: () => ["blockquote", 0],
  list: (n) =>
    n.attrs["ordered"] ? ["ol", { start: String((n.attrs["start"] as number | null) ?? 1) }, 0] : ["ul", 0],
  list_item: (n) => {
    const checked = n.attrs["checked"] as boolean | null;
    return checked === null ? ["li", 0] : ["li", { class: "task", "data-checked": String(checked) }, 0];
  },
  code_block: (n) => ["pre", ["code", n.attrs["lang"] ? { "data-lang": str(n.attrs["lang"]) } : {}, 0]],
  thematic_break: () => ["hr"],
  table: () => ["table", ["tbody", 0]],
  table_row: () => ["tr", 0],
  table_cell: () => ["td", 0],
  raw_block: (n) => ["pre", { class: "raw", "data-kind": str(n.attrs["kind"]) }, str(n.attrs["source"])],
  hard_break: () => ["br"],
  image: (n) => ["span", { class: "image", title: str(n.attrs["src"]) }, str(n.attrs["alt"])],
  raw_inline: (n) => ["code", { class: "raw" }, str(n.attrs["source"])],
};

/** How each mark is shown. Links show their target as a tooltip and do not navigate. */
const marks: Record<string, (mark: Mark) => DOMOutputSpec> = {
  link: (m) => ["a", { title: str(m.attrs["href"]) || str(m.attrs["label"]) }, 0],
  em: () => ["em", 0],
  strong: () => ["strong", 0],
  strike: () => ["s", 0],
  code: () => ["code", 0],
};

/**
 * Reads edited content back from the view. The view shows whitespace as it is (`white-space:
 * pre-wrap`), so none is collapsed and a line break inside a paragraph stays a line break.
 */
class ShownWhitespaceParser extends DOMParser {
  override parse(dom: Parameters<DOMParser["parse"]>[0], options: ParseOptions = {}): Node {
    return super.parse(dom, { ...options, preserveWhitespace: "full" });
  }
}

export const domParser = new ShownWhitespaceParser(schema, DOMParser.fromSchema(schema).rules);

/** Reads pasted content. */
export const clipboardParser = DOMParser.fromSchema(schema);

/** Writes document content to the DOM, for the clipboard. */
export const serializer = new DOMSerializer(nodes, marks);

/** View constructors for every node type and mark, so the core schema needs no DOM specs. */
export function views(document: Document): {
  nodeViews: Record<string, NodeViewConstructor>;
  markViews: Record<string, MarkViewConstructor>;
} {
  const nodeViews: Record<string, NodeViewConstructor> = {};
  for (const [name, spec] of Object.entries(nodes)) {
    nodeViews[name] = (node) => DOMSerializer.renderSpec(document, spec(node));
  }
  const markViews: Record<string, MarkViewConstructor> = {};
  for (const [name, spec] of Object.entries(marks)) {
    markViews[name] = (mark) => DOMSerializer.renderSpec(document, spec(mark));
  }
  return { nodeViews, markViews };
}
