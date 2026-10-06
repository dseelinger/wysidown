import { schema, type MarkdownSource } from "@wysidown/core";
import type { Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";

/** `doc`, or a single empty paragraph to type into when `doc` has no blocks. */
export function shown(doc: Node): Node {
  return doc.childCount === 0 ? schema.nodes.doc.create(null, schema.nodes.paragraph.create()) : doc;
}

/** The document to write for `doc`: a lone empty paragraph is written as no blocks at all. */
export function written(doc: Node, source: MarkdownSource): Node {
  const only = doc.childCount === 1 ? doc.firstChild! : null;
  if (only?.type !== schema.nodes.paragraph || only.content.size > 0) return doc;
  return source.doc.childCount === 0 ? source.doc : schema.nodes.doc.create();
}

/** Puts an empty paragraph back when an edit leaves the document with no blocks. */
export const keepATextblock = new Plugin({
  appendTransaction(_trs, _old, state) {
    if (state.doc.childCount > 0) return null;
    return state.tr.insert(0, schema.nodes.paragraph.create());
  },
});
