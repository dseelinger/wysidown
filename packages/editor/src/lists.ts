import { schema } from "@wysidown/core";
import type { Node } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import type { EditorView, NodeViewConstructor } from "prosemirror-view";

const item = schema.nodes.list_item;

/** True when the selection is inside a list item. */
function inItem(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === item) return true;
  return false;
}

/**
 * Splits the list item at the cursor; in an empty last item of a nested list, moves that item out
 * to the list around it. The item the cursor ends in is an unchecked task when the item before it
 * is a task, and an item left with fewer than two blocks is tight, as markdown can only write it
 * that way.
 */
export const splitItem: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const emptyNestedLast =
    empty &&
    $from.depth >= 4 &&
    $from.parent.content.size === 0 &&
    $from.node(-1).type === item &&
    $from.indexAfter(-1) === $from.node(-1).childCount &&
    $from.indexAfter(-2) === $from.node(-2).childCount &&
    $from.node(-3).type === item;
  return (emptyNestedLast ? liftListItem(item) : splitListItem(item))(
    state,
    dispatch &&
      ((tr) => {
        dispatch(settleSplit(tr));
      }),
  );
};

function settleSplit(tr: Transaction): Transaction {
  const { $from } = tr.selection;
  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type !== item) depth--;
  if (depth === 0) return tr;
  const at = $from.before(depth);
  const fix = (pos: number, node: Node, checked: unknown) => {
    const spread = (node.attrs["spread"] as boolean) && node.childCount > 1;
    if (spread !== node.attrs["spread"] || checked !== node.attrs["checked"])
      tr.setNodeMarkup(pos, null, { ...node.attrs, checked, spread });
  };
  const index = $from.index(depth - 1);
  const before = index > 0 ? $from.node(depth - 1).child(index - 1) : null;
  if (before) fix(at - before.nodeSize, before, before.attrs["checked"]);
  const task = before !== null && before.attrs["checked"] !== null;
  fix(at, tr.doc.nodeAt(at)!, task ? false : null);
  return tr;
}

/** Nests the list item under the one before it. Inside a list, Tab never leaves the editor. */
export const sinkItem: Command = (state, dispatch) => sinkListItem(item)(state, dispatch) || inItem(state);

/** Moves the list item out of its list, to the list around it or out of lists altogether. */
export const liftItem: Command = (state, dispatch) => liftListItem(item)(state, dispatch) || inItem(state);

/** Checks or unchecks the task item at `pos`. */
export function toggleTask(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (node?.type !== item || node.attrs["checked"] === null) return false;
    dispatch?.(state.tr.setNodeMarkup(pos, null, { ...node.attrs, checked: !(node.attrs["checked"] as boolean) }));
    return true;
  };
}

export const listKeys: Record<string, Command> = { Enter: splitItem, Tab: sinkItem, "Shift-Tab": liftItem };

/** A list item; a task item has a checkbox before its content that toggles it when the editor is editable. */
export function listItemView(document: Document): NodeViewConstructor {
  return (node: Node, view: EditorView, getPos: () => number | undefined) => {
    const dom = document.createElement("li");
    const checked = node.attrs["checked"] as boolean | null;
    if (checked === null) return { dom, contentDOM: dom };
    dom.className = "task";
    const box = dom.appendChild(document.createElement("input"));
    box.type = "checkbox";
    box.checked = checked;
    box.contentEditable = "false";
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    box.addEventListener("click", (event) => {
      event.preventDefault();
      const pos = getPos();
      if (view.editable && pos !== undefined) toggleTask(pos)(view.state, view.dispatch);
    });
    const contentDOM = dom.appendChild(document.createElement("div"));
    return { dom, contentDOM, ignoreMutation: (m) => m.target === box };
  };
}
