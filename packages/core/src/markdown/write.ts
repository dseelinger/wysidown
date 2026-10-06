import type * as M from "mdast";
import { frontmatterToMarkdown } from "mdast-util-frontmatter";
import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import { toMarkdown } from "mdast-util-to-markdown";
import type { Mark, Node } from "prosemirror-model";
import type { Style } from "./source.ts";

/**
 * Writes block nodes as markdown with no reference to their source, in the document's style.
 * Raw nodes are written verbatim. The result has no trailing line ending and uses "\n".
 */
export function writeBlocks(nodes: readonly Node[], style: Style): string {
  const root: M.Root = { type: "root", children: nodes.map(toBlock) };
  return toMarkdown(root, {
    bullet: style.bullet,
    bulletOther: style.bullet === "-" ? "*" : "-",
    emphasis: style.emphasis,
    strong: style.strong,
    fence: style.fence,
    rule: style.rule,
    listItemIndent: "one",
    extensions: [gfmToMarkdown(), frontmatterToMarkdown(["yaml", "toml"]), mathToMarkdown()],
  }).replace(/\n$/, "");
}

/** Writes a table cell's inline content with its pipes escaped, without the pipes and padding around it. */
export function writeCell(cell: Node, style: Style): string {
  if (cell.childCount === 0) return "";
  const { table, table_row } = cell.type.schema.nodes;
  const written = writeBlocks([table!.create({ align: [null] }, table_row!.create(null, cell))], style);
  return written.slice(0, written.indexOf("\n")).slice(2, -2);
}

function children(n: Node): M.RootContent[] {
  const out: M.RootContent[] = [];
  n.forEach((c) => out.push(toBlock(c)));
  return out;
}

function toBlock(n: Node): M.RootContent {
  switch (n.type.name) {
    case "paragraph":
      return { type: "paragraph", children: toInline(n) };
    case "heading":
      return { type: "heading", depth: n.attrs["level"] as M.Heading["depth"], children: toInline(n) };
    case "blockquote":
      return { type: "blockquote", children: children(n) as M.BlockContent[] };
    case "list":
      return {
        type: "list",
        ordered: n.attrs["ordered"] as boolean,
        start: n.attrs["start"] as number | null,
        spread: n.attrs["spread"] as boolean,
        children: children(n) as M.ListItem[],
      };
    case "list_item":
      return {
        type: "listItem",
        checked: n.attrs["checked"] as boolean | null,
        spread: n.attrs["spread"] as boolean,
        children: children(n) as M.BlockContent[],
      };
    case "code_block":
      return {
        type: "code",
        lang: n.attrs["lang"] as string | null,
        meta: n.attrs["meta"] as string | null,
        value: n.textContent,
      };
    case "thematic_break":
      return { type: "thematicBreak" };
    case "table":
      return {
        type: "table",
        align: n.attrs["align"] as M.AlignType[],
        children: children(n) as M.TableRow[],
      };
    case "table_row":
      return { type: "tableRow", children: children(n) as M.TableCell[] };
    case "table_cell":
      return { type: "tableCell", children: toInline(n) };
    case "raw_block":
      return { type: "html", value: n.attrs["source"] as string };
    default:
      throw new Error(`No markdown form for node type ${n.type.name}`);
  }
}

function leaf(n: Node): M.PhrasingContent {
  switch (n.type.name) {
    case "text":
      return n.marks.some((m) => m.type.name === "code")
        ? { type: "inlineCode", value: n.text! }
        : { type: "text", value: n.text! };
    case "hard_break":
      return { type: "break" };
    case "image":
      return {
        type: "image",
        url: n.attrs["src"] as string,
        alt: n.attrs["alt"] as string,
        title: n.attrs["title"] as string | null,
      };
    case "raw_inline":
      return { type: "html", value: n.attrs["source"] as string };
    default:
      throw new Error(`No markdown form for node type ${n.type.name}`);
  }
}

function wrap(mark: Mark, nodes: M.PhrasingContent[]): M.PhrasingContent {
  switch (mark.type.name) {
    case "em":
      return { type: "emphasis", children: nodes };
    case "strong":
      return { type: "strong", children: nodes };
    case "strike":
      return { type: "delete", children: nodes };
    case "link": {
      const identifier = mark.attrs["identifier"] as string | null;
      if (identifier === null) {
        return {
          type: "link",
          url: mark.attrs["href"] as string,
          title: mark.attrs["title"] as string | null,
          children: nodes,
        };
      }
      const label = mark.attrs["label"] as string | null;
      const referenceType = mark.attrs["referenceType"] as M.ReferenceType;
      // A shortcut or collapsed reference whose text no longer matches its label must name the label.
      const full = referenceType !== "full" && plainText(nodes) !== label;
      return {
        type: "linkReference",
        identifier,
        label,
        referenceType: full ? "full" : referenceType,
        children: nodes,
      };
    }
    default:
      throw new Error(`No markdown form for mark ${mark.type.name}`);
  }
}

/** Rebuilds mdast nesting from ProseMirror's flat inline content. */
function toInline(block: Node): M.PhrasingContent[] {
  const root: M.PhrasingContent[] = [];
  const open: { mark: Mark; nodes: M.PhrasingContent[] }[] = [];
  const top = () => open[open.length - 1]?.nodes ?? root;
  const closeTo = (depth: number) => {
    while (open.length > depth) {
      const done = open.pop()!;
      top().push(wrap(done.mark, done.nodes));
    }
  };
  block.forEach((n) => {
    const marks = n.marks.filter((m) => m.type.name !== "code");
    let keep = 0;
    while (keep < open.length && keep < marks.length && open[keep]!.mark.eq(marks[keep]!)) keep++;
    closeTo(keep);
    for (let i = keep; i < marks.length; i++) open.push({ mark: marks[i]!, nodes: [] });
    top().push(leaf(n));
  });
  closeTo(0);
  return root;
}

function plainText(nodes: readonly M.Node[]): string {
  return nodes
    .map((n) => ("value" in n ? String(n.value) : "children" in n ? plainText((n as M.Parent).children) : ""))
    .join("");
}
