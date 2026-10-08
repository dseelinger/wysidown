import { schema, type Resources } from "@wysidown/core";
import {
  DOMParser,
  DOMSerializer,
  type DOMOutputSpec,
  type Mark,
  type Node,
  type ParseOptions,
  type TagParseRule,
} from "prosemirror-model";
import type { MarkViewConstructor, NodeViewConstructor } from "prosemirror-view";
import { codeBlockView } from "./code.ts";
import { imageView } from "./images.ts";
import { listItemView } from "./lists.ts";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The label a raw block's chip shows, by `kind`. */
const rawLabels: Record<string, string> = {
  alert: "Alert",
  definition: "Link definition",
  footnoteDefinition: "Footnote",
  html: "HTML",
  math: "Math",
  toml: "Front matter",
  yaml: "Front matter",
};

/**
 * How each node type is shown. Raw syntax shows as a chip holding its source text, read-only;
 * a raw block's label is drawn by CSS from `data-label`, so it is not copied with the source.
 */
const nodes: Record<string, (node: Node) => DOMOutputSpec> = {
  paragraph: () => ["p", 0],
  heading: (n) => [`h${String(n.attrs["level"])}`, 0],
  blockquote: () => ["blockquote", 0],
  list: (n) => {
    let loose = n.attrs["spread"] as boolean;
    n.forEach((item) => (loose ||= item.attrs["spread"] as boolean));
    const tight = loose ? {} : { class: "tight" };
    const start = String((n.attrs["start"] as number | null) ?? 1);
    return n.attrs["ordered"] ? ["ol", { ...tight, start }, 0] : ["ul", tight, 0];
  },
  list_item: (n) => {
    const checked = n.attrs["checked"] as boolean | null;
    return checked === null ? ["li", 0] : ["li", { class: "task", "data-checked": String(checked) }, 0];
  },
  code_block: (n) => ["pre", ["code", n.attrs["lang"] ? { "data-lang": str(n.attrs["lang"]) } : {}, 0]],
  thematic_break: () => ["hr"],
  table: () => ["table", ["tbody", 0]],
  table_row: () => ["tr", 0],
  table_cell: () => ["td", 0],
  raw_block: (n) => {
    const kind = str(n.attrs["kind"]);
    return ["pre", { class: "raw", "data-kind": kind, "data-label": rawLabels[kind] ?? kind }, str(n.attrs["source"])];
  },
  hard_break: () => ["br"],
  image: (n) => ["span", { class: "image", title: str(n.attrs["src"]) }, str(n.attrs["alt"])],
  raw_inline: (n) => ["code", { class: "raw" }, str(n.attrs["source"])],
};

/** How each mark is shown. Links show their target as a tooltip and do not navigate. */
const marks: Record<string, (mark: Mark) => DOMOutputSpec> = {
  link: (m) => [
    "a",
    {
      title: str(m.attrs["href"]) || str(m.attrs["label"]),
      "data-href": str(m.attrs["href"]),
      "data-title": m.attrs["title"] as string | null,
      "data-identifier": m.attrs["identifier"] as string | null,
      "data-label": m.attrs["label"] as string | null,
      "data-reference-type": m.attrs["referenceType"] as string | null,
    },
    0,
  ],
  em: () => ["em", 0],
  strong: () => ["strong", 0],
  strike: () => ["s", 0],
  code: () => ["code", 0],
};

/**
 * Reads edited content back from the view. The view shows whitespace as it is (`white-space:
 * pre-wrap`) apart from soft line breaks, which show as spaces; none is collapsed when read, so a
 * soft line break stays `\n`.
 */
class ShownWhitespaceParser extends DOMParser {
  override parse(dom: Parameters<DOMParser["parse"]>[0], options: ParseOptions = {}): Node {
    return super.parse(dom, { ...options, preserveWhitespace: "full" });
  }
}

/** Reads back a link the view draws, which ProseMirror re-reads from the DOM after a composition in its text. */
const shownLink: TagParseRule = {
  tag: "a[data-href]",
  mark: "link",
  getAttrs: (d) => ({
    href: d.getAttribute("data-href") ?? "",
    title: d.getAttribute("data-title"),
    identifier: d.getAttribute("data-identifier"),
    label: d.getAttribute("data-label"),
    referenceType: d.getAttribute("data-reference-type"),
  }),
};

export const domParser = new ShownWhitespaceParser(schema, [...DOMParser.fromSchema(schema).rules, shownLink]);

/**
 * Writes document content to the DOM, for the clipboard: standard HTML for other programs, with
 * the attributes `clipboardParser` needs to read it back unchanged.
 */
export const serializer = new DOMSerializer(
  {
    ...nodes,
    table: (n) => [
      "table",
      { "data-align": (n.attrs["align"] as (string | null)[]).map((a) => a ?? "").join(",") },
      ["tbody", 0],
    ],
    raw_block: (n) => {
      const [tag, attrs, content] = nodes["raw_block"]!(n) as [string, Record<string, string>, string];
      return [tag, { ...attrs, "data-identifier": n.attrs["identifier"] as string | null }, content];
    },
    image: (n) => [
      "img",
      { src: str(n.attrs["src"]), alt: str(n.attrs["alt"]), title: n.attrs["title"] as string | null },
    ],
    raw_inline: (n) => [
      "code",
      { class: "raw", "data-identifier": n.attrs["identifier"] as string | null },
      str(n.attrs["source"]),
    ],
  },
  {
    ...marks,
    link: (m) => [
      "a",
      {
        href: str(m.attrs["href"]),
        "data-title": m.attrs["title"] as string | null,
        "data-identifier": m.attrs["identifier"] as string | null,
        "data-label": m.attrs["label"] as string | null,
        "data-reference-type": m.attrs["referenceType"] as string | null,
      },
      0,
    ],
  },
);

/**
 * View constructors for every node type and mark, so the core schema needs no DOM specs. Images
 * resolve against `resources` when they are drawn.
 */
export function views(
  document: Document,
  resources: () => Resources,
): {
  nodeViews: Record<string, NodeViewConstructor>;
  markViews: Record<string, MarkViewConstructor>;
} {
  const nodeViews: Record<string, NodeViewConstructor> = {};
  for (const [name, spec] of Object.entries(nodes)) {
    nodeViews[name] = (node) => DOMSerializer.renderSpec(document, spec(node));
  }
  nodeViews["list_item"] = listItemView(document);
  nodeViews["code_block"] = codeBlockView(document);
  nodeViews["image"] = imageView(document, resources);
  const markViews: Record<string, MarkViewConstructor> = {};
  for (const [name, spec] of Object.entries(marks)) {
    markViews[name] = (mark) => DOMSerializer.renderSpec(document, spec(mark));
  }
  return { nodeViews, markViews };
}
