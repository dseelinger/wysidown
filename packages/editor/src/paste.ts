import { parseMarkdown, schema } from "@wysidown/core";
import {
  DOMParser,
  Fragment,
  Slice,
  type Attrs,
  type Node as ProseMirrorNode,
  type ParseOptions,
  type ParseRule,
} from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/**
 * Markdown text as document content. A paragraph at the start is open, so it joins the paragraph
 * at the cursor; a single line keeps the spaces around it.
 */
export function markdownSlice(text: string): Slice {
  const markdown = text.replace(/\r\n?/g, "\n");
  // A leading line break keeps a `---` at the start from being read as front matter.
  let content = parseMarkdown("\n" + markdown).doc.content;
  const first = content.firstChild;
  if (content.childCount === 1 && first?.type === schema.nodes.paragraph && !markdown.trim().includes("\n")) {
    const before = /^[ \t]*/.exec(markdown)?.[0] ?? "";
    const after = /[ \t]*$/.exec(markdown)?.[0] ?? "";
    const inline: ProseMirrorNode[] = [];
    if (before) inline.push(schema.text(before));
    first.forEach((child) => inline.push(child));
    if (after) inline.push(schema.text(after));
    content = Fragment.from(first.copy(Fragment.fromArray(inline)));
  }
  return new Slice(content, first?.type === schema.nodes.paragraph ? 1 : 0, Slice.maxOpen(content).openEnd);
}

/** Text taken literally: blank lines separate paragraphs, and other line breaks stay line breaks. */
export function plainSlice(text: string): Slice {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p !== "")
    .map((p) => schema.nodes.paragraph.create(null, schema.text(p)));
  return Slice.maxOpen(Fragment.fromArray(paragraphs));
}

/** A VS Code language id as a code block's language. */
function languageOf(mode: string): string {
  const languages: Record<string, string> = {
    shellscript: "sh",
    javascriptreact: "jsx",
    typescriptreact: "tsx",
  };
  return languages[mode] ?? mode;
}

/**
 * Text copied from a VS Code editor: markdown is read as markdown, several lines of code become a
 * code block in the file's language, and anything else is taken literally. Null when the
 * clipboard does not hold VS Code's editor data.
 */
export function vscodeSlice(data: DataTransfer): Slice | null {
  const editorData = data.getData("vscode-editor-data");
  if (!editorData) return null;
  let mode = "";
  try {
    const parsed: unknown = JSON.parse(editorData);
    if (parsed && typeof parsed === "object" && "mode" in parsed && typeof parsed.mode === "string") mode = parsed.mode;
  } catch {
    return null;
  }
  const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
  if (mode === "markdown") return markdownSlice(text);
  const code = text.replace(/\n$/, "");
  if (!code.includes("\n") || mode === "" || mode === "plaintext") return plainSlice(text);
  const block = schema.nodes.code_block.create({ lang: languageOf(mode) }, schema.text(code));
  return new Slice(Fragment.from(block), 0, 0);
}

const unsafeTarget = /^\s*(javascript|vbscript|data):/i;
const unloadableImage = /^\s*(data|file|blob|cid|javascript|vbscript):/i;

function checkedOf(item: HTMLElement): boolean | null {
  const own = item.getAttribute("data-checked");
  if (own !== null) return own === "true";
  const box = item.querySelector(":scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]");
  return box ? box.hasAttribute("checked") : null;
}

function langOf(pre: HTMLElement): string | null {
  const own = pre.querySelector(":scope > code[data-lang]")?.getAttribute("data-lang");
  if (own) return own;
  const classes = [pre, pre.querySelector(":scope > code"), pre.closest("[class*=highlight-source-]")]
    .map((e) => e?.getAttribute("class") ?? "")
    .join(" ");
  return /(?:^|\s)(?:language-|lang-|highlight-source-)([\w+#-]+)/.exec(classes)?.[1] ?? null;
}

function alignOf(table: HTMLElement): (string | null)[] {
  const own = table.getAttribute("data-align");
  if (own !== null) return own.split(",").map((a) => a || null);
  const first = table.querySelector("tr");
  if (!first) return [];
  return Array.from(first.children, (cell) => {
    const align = (cell.getAttribute("align") ?? styleValue(cell, "text-align")).toLowerCase();
    return align === "left" || align === "center" || align === "right" ? align : null;
  });
}

const headings: ParseRule[] = [1, 2, 3, 4, 5, 6].map((level) => ({
  tag: `h${String(level)}`,
  node: "heading",
  attrs: { level },
}));

/** How pasted HTML becomes document content: the editor's own copies, web pages, Word and Google Docs. */
const rules: ParseRule[] = [
  {
    tag: "pre.raw[data-kind]",
    node: "raw_block",
    getAttrs: (d): Attrs => ({
      source: d.textContent,
      kind: d.getAttribute("data-kind"),
      identifier: d.getAttribute("data-identifier"),
    }),
  },
  {
    tag: "code.raw",
    node: "raw_inline",
    getAttrs: (d): Attrs => ({ source: d.textContent, identifier: d.getAttribute("data-identifier") }),
  },
  { tag: "p", node: "paragraph" },
  ...headings,
  { tag: "blockquote", node: "blockquote" },
  { tag: "ul", node: "list", attrs: { ordered: false } },
  {
    tag: "ol",
    node: "list",
    getAttrs: (d): Attrs => {
      const start = Number.parseInt(d.getAttribute("start") ?? "", 10);
      return { ordered: true, start: Number.isInteger(start) && start !== 1 && start >= 0 ? start : null };
    },
  },
  { tag: "li", node: "list_item", getAttrs: (d): Attrs => ({ checked: checkedOf(d) }) },
  { tag: "input", ignore: true },
  {
    tag: "pre",
    node: "code_block",
    preserveWhitespace: "full",
    getAttrs: (d): Attrs => ({ lang: langOf(d) }),
    getContent: (d) => {
      const code = (d.textContent ?? "").replace(/\r\n?/g, "\n").replace(/\n$/, "");
      return code === "" ? Fragment.empty : Fragment.from(schema.text(code));
    },
  },
  { tag: "hr", node: "thematic_break" },
  { tag: "table", node: "table", getAttrs: (d): Attrs => ({ align: alignOf(d) }) },
  { tag: "tr", node: "table_row" },
  { tag: "th", node: "table_cell" },
  { tag: "td", node: "table_cell" },
  { tag: "br", node: "hard_break" },
  {
    tag: "img[src]",
    node: "image",
    getAttrs: (d) => {
      const src = d.getAttribute("src") ?? "";
      if (src === "" || unloadableImage.test(src)) return false;
      return { src, alt: d.getAttribute("alt") ?? "", title: d.getAttribute("title") };
    },
  },
  {
    tag: "a",
    mark: "link",
    getAttrs: (d) => {
      const href = d.getAttribute("href");
      const referenceType = d.getAttribute("data-reference-type");
      if ((href === null && !referenceType) || unsafeTarget.test(href ?? "")) return false;
      return {
        href: href ?? "",
        title: d.getAttribute("data-title"),
        identifier: d.getAttribute("data-identifier"),
        label: d.getAttribute("data-label"),
        referenceType,
      };
    },
  },
  { tag: "em", mark: "em" },
  { tag: "i", mark: "em" },
  { tag: "strong", mark: "strong" },
  { tag: "b", mark: "strong" },
  { tag: "s", mark: "strike" },
  { tag: "del", mark: "strike" },
  { tag: "strike", mark: "strike" },
  { tag: "code", mark: "code" },
  { tag: "kbd", mark: "code" },
  { tag: "samp", mark: "code" },
  { tag: "tt", mark: "code" },
];

/**
 * Clipboard HTML without `<style>` elements and with each `style` attribute renamed `data-style`,
 * so that parsing it applies no style, which the editor's content security policy forbids.
 */
export function withoutStyles(html: string): string {
  return html
    .replace(/<style[\s>][\s\S]*?<\/style\s*>/gi, "")
    .replace(/<[a-zA-Z][^>]*>/g, (tag) => tag.replace(/(\s)style\s*=/gi, "$1data-style="));
}

/** The value of the CSS property `name` in `element`'s `data-style`, lower case; empty when it has none. */
function styleValue(element: Element, name: string): string {
  const declarations = (element.getAttribute("data-style") ?? "").split(";");
  for (const declaration of declarations) {
    const colon = declaration.indexOf(":");
    if (colon >= 0 && declaration.slice(0, colon).trim().toLowerCase() === name)
      return declaration
        .slice(colon + 1)
        .trim()
        .toLowerCase();
  }
  return "";
}

/** Bold, italic and struck-through styles (Google Docs' spans) as `strong`, `em` and `s` elements. */
function inlineStyles(root: Element): void {
  for (const element of Array.from(root.querySelectorAll("[data-style]"))) {
    const weight = styleValue(element, "font-weight");
    const marks = [
      /^(bold|bolder|[6-9]00)$/.test(weight) && "strong",
      styleValue(element, "font-style") === "italic" && "em",
      `${styleValue(element, "text-decoration")} ${styleValue(element, "text-decoration-line")}`.includes(
        "line-through",
      ) && "s",
    ];
    for (const tag of marks) {
      if (!tag) continue;
      const wrapper = element.ownerDocument.createElement(tag);
      wrapper.append(...Array.from(element.childNodes));
      element.append(wrapper);
    }
    if (element.localName === "b" && /^(normal|[1-5]00)$/.test(weight)) unwrap(element);
  }
}

const blockTags = "p, div, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, table";

/** Moves `element`'s children to where it is, and removes it. */
function unwrap(element: Element): void {
  element.replaceWith(...Array.from(element.childNodes));
}

/** Word's list paragraphs (`mso-list:l0 level1`) as nested `ul` and `ol` lists. */
function wordLists(root: Element): void {
  const listLevel = (node: ChildNode | null): number => {
    if (!(node instanceof HTMLElement) || node.localName !== "p") return 0;
    const m = /mso-list:\s*l\d+\s+level(\d+)/i.exec(node.getAttribute("data-style") ?? "");
    return m ? Number(m[1]) : 0;
  };
  const nextElement = (node: ChildNode): ChildNode | null => {
    let next = node.nextSibling;
    while (next?.nodeType === 3 && (next.textContent ?? "").trim() === "") next = next.nextSibling;
    return next;
  };
  for (const start of Array.from(root.querySelectorAll("p"))) {
    if (!start.isConnected || listLevel(start) === 0) continue;
    const document = start.ownerDocument;
    const top = document.createElement("div");
    start.before(top);
    const stack: { level: number; list: HTMLElement }[] = [];
    for (let p: ChildNode | null = start; p && listLevel(p) > 0;) {
      const paragraph = p as HTMLElement;
      const level = listLevel(paragraph);
      const next = nextElement(paragraph);
      const markers = Array.from(paragraph.querySelectorAll("span")).filter((s) =>
        /mso-list:\s*Ignore/i.test(s.getAttribute("data-style") ?? ""),
      );
      const marker = (markers[0]?.textContent ?? "").replace(/\s/g, "");
      for (const m of markers) m.remove();
      while (stack.length > 0 && stack[stack.length - 1]!.level > level) stack.pop();
      if (stack.length === 0 || stack[stack.length - 1]!.level < level) {
        const list = document.createElement(/^[\da-zA-Z]+[.)]$/.test(marker) ? "ol" : "ul");
        const parent = stack.length === 0 ? top : (stack[stack.length - 1]!.list.lastElementChild ?? top);
        parent.append(list);
        stack.push({ level, list });
      }
      const item = document.createElement("li");
      const content = document.createElement("p");
      content.append(...Array.from(paragraph.childNodes));
      item.append(content);
      stack[stack.length - 1]!.list.append(item);
      paragraph.remove();
      p = next;
    }
    unwrap(top);
  }
}

/** VS Code's coloured copy (a `white-space: pre` block of line `div`s) of more than one line as a `pre`. */
function vscodeBlocks(root: Element): void {
  for (const block of Array.from(root.querySelectorAll("div"))) {
    if (!/white-space:\s*pre/.test(block.getAttribute("data-style") ?? "")) continue;
    const lines = Array.from(block.children).filter((c) => c.localName === "div");
    if (lines.length < 2) continue;
    const pre = block.ownerDocument.createElement("pre");
    pre.textContent = lines.map((line) => line.textContent).join("\n");
    block.replaceWith(pre);
  }
}

/** Gives every row of a table the same number of cells, each holding only inline content. */
function tableCells(root: Element): void {
  for (const table of Array.from(root.querySelectorAll("table"))) {
    for (const caption of Array.from(table.querySelectorAll("caption"))) caption.remove();
    const rows = Array.from(table.querySelectorAll("tr")).filter((r) => r.closest("table") === table);
    const width = Math.max(0, ...rows.map((r) => r.children.length));
    for (const row of rows) {
      for (const cell of Array.from(row.children)) {
        for (const block of Array.from(cell.querySelectorAll(blockTags)).reverse()) {
          block.after(" ");
          unwrap(block);
        }
        for (const br of Array.from(cell.querySelectorAll("br"))) br.replaceWith(" ");
      }
      while (row.children.length < width) row.append(row.ownerDocument.createElement("td"));
    }
  }
}

/** Tidies clipboard HTML in place before it is parsed. */
export function tidy(root: Element): void {
  // Office's own elements (`o:p`, `v:shape`) hold nothing that is shown.
  for (const element of Array.from(root.querySelectorAll("*"))) if (element.localName.includes(":")) element.remove();
  wordLists(root);
  inlineStyles(root);
  vscodeBlocks(root);
  tableCells(root);
  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    for (const br of Array.from(pre.querySelectorAll("br"))) br.replaceWith("\n");
  }
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (text.parentElement?.closest("pre")) continue;
    text.textContent = (text.textContent ?? "").replace(/\u00a0/g, " ");
  }
  for (const block of Array.from(root.querySelectorAll("p, h1, h2, h3, h4, h5, h6"))) {
    if (block.textContent.trim() === "" && !block.querySelector("img")) block.remove();
  }
}

/**
 * Content copied from the editor (ProseMirror asks for whitespace to be kept) keeps its line
 * breaks; other HTML is tidied first. `foreign` says which the latest parse was.
 */
class PasteParser extends DOMParser {
  foreign = false;

  override parseSlice(dom: Parameters<DOMParser["parseSlice"]>[0], options: ParseOptions = {}): Slice {
    this.foreign = !options.preserveWhitespace;
    if (!this.foreign) return super.parseSlice(dom, { ...options, preserveWhitespace: "full" });
    if (dom instanceof Element) tidy(dom);
    return super.parseSlice(dom, options);
  }
}

/** Reads pasted and dropped HTML. */
export const clipboardParser = new PasteParser(schema, rules);

/** Runs `slice` through every plugin's `transformPasted`, as a paste does. */
function transformed(view: EditorView, slice: Slice): Slice {
  let result = slice;
  view.someProp("transformPasted", (f) => {
    result = f(result, view, false);
  });
  return result;
}

/**
 * Pasted text is read as markdown, and taken literally with Ctrl+Shift+V. HTML is converted to
 * the document's nodes; text from a VS Code editor is pasted as markdown, code or text by its
 * language.
 */
export function paste(): Plugin {
  let plain = false;
  return new Plugin({
    props: {
      clipboardParser,
      transformPastedHTML: withoutStyles,
      transformPasted(slice) {
        const foreign = clipboardParser.foreign;
        clipboardParser.foreign = false;
        // A heading, list or code block from another program does not join the paragraph at the cursor.
        return foreign && slice.openStart > 0 && slice.content.firstChild?.type !== schema.nodes.paragraph
          ? new Slice(slice.content, 0, slice.openEnd)
          : slice;
      },
      clipboardTextParser(text, _context, asPlain) {
        plain = asPlain;
        return asPlain ? plainSlice(text) : markdownSlice(text);
      },
      handlePaste(view, event) {
        const wasPlain = plain;
        plain = false;
        if (wasPlain || !event.clipboardData || view.state.selection.$from.parent.type.spec.code) return false;
        const slice = vscodeSlice(event.clipboardData);
        if (!slice) return false;
        view.dispatch(
          view.state.tr
            .replaceSelection(transformed(view, slice))
            .scrollIntoView()
            .setMeta("paste", true)
            .setMeta("uiEvent", "paste"),
        );
        return true;
      },
    },
  });
}
