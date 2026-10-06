import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import { frontmatterToMarkdown } from "mdast-util-frontmatter";
import { mathToMarkdown } from "mdast-util-math";
import type { Mark, Node as PMNode } from "prosemirror-model";
import type * as M from "mdast";
import type { Style } from "./parse.ts";

/** Serializes one block in the document's detected style, without a trailing line ending. */
export function canonical(node: PMNode, style: Style): string {
  const root: M.Root = { type: "root", children: [toBlock(node) as M.RootContent] };
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

/** Serializes a whole document with no source reuse. */
export function canonicalDoc(doc: PMNode, style: Style): string {
  const children: M.RootContent[] = [];
  doc.forEach((c) => children.push(toBlock(c) as M.RootContent));
  return toMarkdown(
    { type: "root", children },
    {
      bullet: style.bullet,
      bulletOther: style.bullet === "-" ? "*" : "-",
      emphasis: style.emphasis,
      strong: style.strong,
      fence: style.fence,
      rule: style.rule,
      listItemIndent: "one",
      extensions: [gfmToMarkdown(), frontmatterToMarkdown(["yaml", "toml"]), mathToMarkdown()],
    },
  );
}

function toBlock(n: PMNode): M.Node {
  const kids = () => {
    const out: M.Node[] = [];
    n.forEach((c) => out.push(toBlock(c)));
    return out;
  };
  switch (n.type.name) {
    case "paragraph":
      return { type: "paragraph", children: toInline(n) } as M.Paragraph;
    case "heading":
      return { type: "heading", depth: n.attrs.level, children: toInline(n) } as M.Heading;
    case "blockquote":
      return { type: "blockquote", children: kids() } as M.Blockquote;
    case "list":
      return {
        type: "list",
        ordered: n.attrs.ordered,
        start: n.attrs.start,
        spread: n.attrs.spread,
        children: kids(),
      } as M.List;
    case "list_item":
      return { type: "listItem", checked: n.attrs.checked, spread: n.attrs.spread, children: kids() } as M.ListItem;
    case "code_block":
      return { type: "code", lang: n.attrs.lang, meta: n.attrs.meta, value: n.textContent } as M.Code;
    case "thematic_break":
      return { type: "thematicBreak" } as M.ThematicBreak;
    case "table":
      return { type: "table", align: n.attrs.align, children: kids() } as M.Table;
    case "table_row":
      return { type: "tableRow", children: kids() } as M.TableRow;
    case "table_cell":
      return { type: "tableCell", children: toInline(n) } as M.TableCell;
    case "raw_block":
      return { type: "html", value: n.attrs.source } as M.Html;
    default:
      throw new Error(`no canonical form for ${n.type.name}`);
  }
}

function leaf(n: PMNode): M.PhrasingContent {
  switch (n.type.name) {
    case "text":
      return n.marks.some((m) => m.type.name === "code")
        ? { type: "inlineCode", value: n.text! }
        : { type: "text", value: n.text! };
    case "hard_break":
      return { type: "break" };
    case "image":
      return { type: "image", url: n.attrs.src, alt: n.attrs.alt, title: n.attrs.title };
    case "raw_inline":
      return { type: "html", value: n.attrs.source };
    default:
      throw new Error(`no canonical form for ${n.type.name}`);
  }
}

function wrap(mark: Mark, children: M.PhrasingContent[]): M.PhrasingContent {
  switch (mark.type.name) {
    case "em":
      return { type: "emphasis", children };
    case "strong":
      return { type: "strong", children };
    case "strike":
      return { type: "delete", children };
    case "link":
      return mark.attrs.identifier
        ? {
            type: "linkReference",
            identifier: mark.attrs.identifier,
            label: mark.attrs.label,
            referenceType:
              mark.attrs.referenceType !== "full" && plain(children) !== mark.attrs.label ? "full" : mark.attrs.referenceType,
            children,
          }
        : { type: "link", url: mark.attrs.href, title: mark.attrs.title, children };
    default:
      throw new Error(`no canonical form for mark ${mark.type.name}`);
  }
}

/** Rebuilds mdast nesting from ProseMirror's flat marked inline content. */
function toInline(block: PMNode): M.PhrasingContent[] {
  const root: M.PhrasingContent[] = [];
  const stack: { mark: Mark; children: M.PhrasingContent[] }[] = [];
  const top = () => (stack.length ? stack[stack.length - 1]!.children : root);
  block.forEach((n) => {
    const marks = n.marks.filter((m) => m.type.name !== "code");
    let keep = 0;
    while (keep < stack.length && keep < marks.length && stack[keep]!.mark.eq(marks[keep]!)) keep++;
    while (stack.length > keep) {
      const done = stack.pop()!;
      top().push(wrap(done.mark, done.children));
    }
    for (let i = keep; i < marks.length; i++) stack.push({ mark: marks[i]!, children: [] });
    top().push(leaf(n));
  });
  while (stack.length) {
    const done = stack.pop()!;
    top().push(wrap(done.mark, done.children));
  }
  return root;
}

function plain(nodes: M.PhrasingContent[]): string {
  return nodes.map((n) => ("value" in n ? n.value : "children" in n ? plain(n.children as M.PhrasingContent[]) : "")).join("");
}
