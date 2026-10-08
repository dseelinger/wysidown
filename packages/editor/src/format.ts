import { schema } from "@wysidown/core";
import { toggleMark } from "prosemirror-commands";
import type { MarkType, Node } from "prosemirror-model";
import type { Command } from "prosemirror-state";

const { paragraph, heading, list_item: item } = schema.nodes;

/** Toggles `mark` on the selection, or for the text typed next when the selection is empty. */
function mark(type: MarkType): Command {
  return (state, dispatch) => {
    toggleMark(type)(state, dispatch);
    return true;
  };
}

/**
 * Turns the paragraphs and headings in the selection into headings of `level`, or into
 * paragraphs when all of them already are. Other textblocks, and the text of a task item, are
 * left as they are.
 */
export function setHeading(level: number): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const blocks: { node: Node; pos: number }[] = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if ((node.type === paragraph || node.type === heading) && !startsTask(state.doc, pos)) blocks.push({ node, pos });
      return !node.isTextblock;
    });
    if (blocks.length === 0 || !dispatch) return true;
    const undo = blocks.every(({ node }) => node.type === heading && node.attrs["level"] === level);
    const tr = state.tr;
    for (const { node, pos } of blocks) {
      if (undo) tr.setNodeMarkup(pos, paragraph);
      else if (node.type !== heading || node.attrs["level"] !== level) tr.setNodeMarkup(pos, heading, { level });
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** True when the block at `pos` is the first block of a task item, after its checkbox. */
function startsTask(doc: Node, pos: number): boolean {
  const $pos = doc.resolve(pos);
  return $pos.index() === 0 && $pos.parent.type === item && $pos.parent.attrs["checked"] !== null;
}

/** The keys that format text. Each consumes its key even where it changes nothing. */
export const formatKeys: Record<string, Command> = {
  "Mod-b": mark(schema.marks.strong),
  "Mod-i": mark(schema.marks.em),
  "Shift-Mod-x": mark(schema.marks.strike),
  "Mod-e": mark(schema.marks.code),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((level) => [`Mod-${String(level)}`, setHeading(level)])),
};
