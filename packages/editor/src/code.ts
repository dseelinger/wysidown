import { schema } from "@wysidown/core";
import { newlineInCode } from "prosemirror-commands";
import type { Node } from "prosemirror-model";
import { TextSelection, type Command, type EditorState } from "prosemirror-state";
import type { EditorView, NodeViewConstructor } from "prosemirror-view";

const code = schema.nodes.code_block;

/** Languages the language picker suggests; any other name can be typed. */
export const languages: readonly string[] = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "kotlin",
  "markdown",
  "mermaid",
  "php",
  "powershell",
  "python",
  "ruby",
  "rust",
  "sh",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "xml",
  "yaml",
];

function inCode(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return $from.parent.type === code && $to.sameParent($from);
}

/** The positions of the starts of the lines the selection touches in its code block. */
function lineStarts(state: EditorState): number[] {
  const { $from, from, to } = state.selection;
  const start = $from.start();
  const text = $from.parent.textContent;
  const starts: number[] = [];
  let at = from === start ? 0 : text.lastIndexOf("\n", from - start - 1) + 1;
  while (at >= 0 && (start + at < to || starts.length === 0)) {
    starts.push(start + at);
    const next = text.indexOf("\n", at);
    at = next < 0 ? -1 : next + 1;
  }
  return starts;
}

/** In a code block, inserts a tab; with lines selected, puts a tab at the start of each. */
export const indentCode: Command = (state, dispatch) => {
  if (!inCode(state)) return false;
  const { from, to } = state.selection;
  const text = state.doc.textBetween(from, to);
  if (!text.includes("\n")) {
    dispatch?.(state.tr.insertText("\t").scrollIntoView());
    return true;
  }
  const tr = state.tr;
  for (const at of lineStarts(state).reverse()) tr.insertText("\t", at);
  dispatch?.(tr.scrollIntoView());
  return true;
};

/** In a code block, removes a tab from the start of each line the selection touches. */
export const outdentCode: Command = (state, dispatch) => {
  if (!inCode(state)) return false;
  const tr = state.tr;
  for (const at of lineStarts(state).reverse()) {
    if (state.doc.textBetween(at, at + 1) === "\t") tr.delete(at, at + 1);
  }
  if (tr.docChanged) dispatch?.(tr.scrollIntoView());
  return true;
};

/** Sets the language of the code block at `pos`; null or blank leaves it with none. */
export function setLanguage(pos: number, lang: string | null): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (node?.type !== code) return false;
    const name = lang?.trim().split(/\s+/)[0] ?? "";
    const attrs = name === "" ? { lang: null, meta: null } : { lang: name, meta: node.attrs["meta"] as string | null };
    if (attrs.lang === node.attrs["lang"]) return true;
    dispatch?.(state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...attrs }));
    return true;
  };
}

export const codeKeys: Record<string, Command> = {
  Tab: indentCode,
  "Shift-Tab": outdentCode,
  Enter: newlineInCode,
};

const listId = "wysidown-languages";

/** The datalist of suggested languages, added to the document once. */
function languageList(document: Document): string {
  if (!document.getElementById(listId)) {
    const list = document.body.appendChild(document.createElement("datalist"));
    list.id = listId;
    for (const name of languages) list.appendChild(document.createElement("option")).value = name;
  }
  return listId;
}

/** A code block with a language picker above its text. */
export function codeBlockView(document: Document): NodeViewConstructor {
  return (initial: Node, view: EditorView, getPos: () => number | undefined) => {
    let node = initial;
    const dom = document.createElement("div");
    dom.className = "code-block";
    const bar = dom.appendChild(document.createElement("div"));
    bar.className = "code-bar";
    bar.contentEditable = "false";
    const input = bar.appendChild(document.createElement("input"));
    input.type = "text";
    input.className = "code-lang";
    input.placeholder = "Language";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Code language");
    input.setAttribute("list", languageList(document));
    const pre = dom.appendChild(document.createElement("pre"));
    const contentDOM = pre.appendChild(document.createElement("code"));

    const show = () => {
      input.value = (node.attrs["lang"] as string | null) ?? "";
    };
    show();

    const commit = () => {
      const pos = getPos();
      if (pos !== undefined && view.editable) setLanguage(pos, input.value)(view.state, view.dispatch);
      show();
    };
    input.addEventListener("change", commit);
    input.addEventListener("input", (event) => {
      // Choosing a suggestion from the list replaces the whole value at once.
      if (!(event instanceof InputEvent) || event.inputType === "insertReplacementText") commit();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        if (event.key === "Enter") commit();
        else show();
        const pos = getPos();
        if (pos !== undefined) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
        view.focus();
      }
    });

    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== code) return false;
        node = next;
        if (document.activeElement !== input) show();
        return true;
      },
      stopEvent: (event) => bar.contains(event.target as globalThis.Node),
      ignoreMutation: (mutation) => mutation.type !== "selection" && bar.contains(mutation.target),
    };
  };
}
