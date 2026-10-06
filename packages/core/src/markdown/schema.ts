import { Schema } from "prosemirror-model";

/**
 * The document model. Syntax with no node of its own is kept as `raw_block` or `raw_inline`,
 * holding its source text, so that it saves unchanged.
 */
export const schema = new Schema({
  nodes: {
    doc: { content: "block*" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    blockquote: { group: "block", content: "block*" },
    list: {
      group: "block",
      content: "list_item*",
      attrs: { ordered: { default: false }, start: { default: null }, spread: { default: false } },
    },
    list_item: { content: "block*", attrs: { checked: { default: null }, spread: { default: false } } },
    code_block: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      attrs: { lang: { default: null }, meta: { default: null } },
    },
    thematic_break: { group: "block" },
    table: { group: "block", content: "table_row+", attrs: { align: { default: [] } } },
    table_row: { content: "table_cell+" },
    /** A table cell is one line: it holds no hard break. */
    table_cell: { content: "(text | image | raw_inline)*" },
    /**
     * `kind` is the mdast type (definition, footnoteDefinition, html, yaml, toml or math), or
     * `alert` for a top-level blockquote that starts with `[!NOTE]` and the like. `identifier` is
     * the normalized label of a link or footnote definition.
     */
    raw_block: { group: "block", atom: true, attrs: { source: {}, kind: {}, identifier: { default: null } } },
    text: { group: "inline" },
    hard_break: { group: "inline", inline: true },
    image: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { src: {}, alt: { default: "" }, title: { default: null } },
    },
    /** `identifier` is the normalized label of a footnote or image reference. */
    raw_inline: { group: "inline", inline: true, atom: true, attrs: { source: {}, identifier: { default: null } } },
  },
  marks: {
    link: {
      attrs: {
        href: { default: "" },
        title: { default: null },
        identifier: { default: null },
        label: { default: null },
        referenceType: { default: null },
      },
      inclusive: false,
    },
    em: {},
    strong: {},
    strike: {},
    code: {},
  },
});
