import { parseMarkdown, positionAt, sourceOffsetAt } from "@wysidown/core";
import { TextSelection, type EditorState, type Selection } from "prosemirror-state";

/** A selection in a document's source: offsets in its text, excluding any byte order mark. */
export interface SourceSelection {
  anchor: number;
  head: number;
}

/** The source offsets of `state`'s selection, where `text` is the document's text as written. */
export function sourceSelectionOf(state: EditorState, text: string): SourceSelection {
  const source = parseMarkdown(text);
  if (source.doc.childCount === 0 || !source.doc.eq(state.doc)) return { anchor: 0, head: 0 };
  const { anchor, head } = state.selection;
  return { anchor: sourceOffsetAt(source, anchor), head: sourceOffsetAt(source, head) };
}

/** The selection of `state` at `selection`'s source offsets, where `text` is the document's text as written. */
export function selectionAtSource(state: EditorState, text: string, selection: SourceSelection): Selection | null {
  const source = parseMarkdown(text);
  if (source.doc.childCount === 0 || !source.doc.eq(state.doc)) return null;
  const { doc } = state;
  const anchor = doc.resolve(positionAt(source, selection.anchor));
  const head = doc.resolve(positionAt(source, selection.head));
  return TextSelection.between(anchor, head);
}
