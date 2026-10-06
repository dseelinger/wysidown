import type { Node } from "prosemirror-model";
import { Plugin, type Transaction } from "prosemirror-state";

/** Marks a transaction that brings in the host's text, which the definition guard lets through. */
export const fromHost = "wysidown.fromHost";

/** Refuses a transaction that deletes a link or footnote definition while text still refers to it. */
export const keepReferencedDefinitions = new Plugin({
  filterTransaction(tr: Transaction, state) {
    if (!tr.docChanged || tr.getMeta(fromHost) === true) return true;
    const kept = definitions(tr.doc);
    const removed = [...definitions(state.doc)].filter((key) => !kept.has(key));
    if (removed.length === 0) return true;
    const referred = references(tr.doc);
    return removed.every((key) => !referred.has(key));
  },
});

/** Keys of the definitions in `doc`: a link definition's identifier, or `^` and a footnote's. */
function definitions(doc: Node): Set<string> {
  const out = new Set<string>();
  doc.descendants((node) => {
    if (node.isTextblock) return false;
    const identifier = node.attrs["identifier"] as string | null | undefined;
    if (node.type.name === "raw_block" && identifier != null) {
      out.add(node.attrs["kind"] === "footnoteDefinition" ? "^" + identifier : identifier);
    }
    return true;
  });
  return out;
}

/** Keys of the definitions that reference links, image references and footnote references in `doc` refer to. */
function references(doc: Node): Set<string> {
  const out = new Set<string>();
  doc.descendants((node) => {
    const identifier = node.attrs["identifier"] as string | null | undefined;
    if (node.type.name === "raw_inline" && identifier != null) {
      out.add((node.attrs["source"] as string).startsWith("!") ? identifier : "^" + identifier);
    }
    for (const mark of node.marks) {
      const label = mark.attrs["identifier"] as string | null | undefined;
      if (mark.type.name === "link" && label != null) out.add(label);
    }
    return true;
  });
  return out;
}
