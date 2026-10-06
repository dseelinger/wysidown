import type { Node } from "prosemirror-model";
import type { Transform } from "prosemirror-transform";
import { schema } from "./schema.ts";

export type Alignment = "left" | "center" | "right" | null;

/** The position before row `index` of the table at `pos`. */
function rowPos(table: Node, pos: number, index: number): number {
  let at = pos + 1;
  for (let k = 0; k < index; k++) at += table.child(k).nodeSize;
  return at;
}

/** The position before cell `index` of the row at `pos`. */
function cellPos(row: Node, pos: number, index: number): number {
  let at = pos + 1;
  for (let k = 0; k < index; k++) at += row.child(k).nodeSize;
  return at;
}

function tableAt(tr: Transform, pos: number): Node {
  const table = tr.doc.nodeAt(pos);
  if (table?.type !== schema.nodes.table) throw new Error(`No table at ${String(pos)}`);
  return table;
}

/** Inserts an empty row, as many cells wide as the header, before row `index` (1 or more) of the table at `pos`. */
export function insertTableRow<T extends Transform>(tr: T, pos: number, index: number): T {
  const table = tableAt(tr, pos);
  if (index < 1) throw new Error("A row cannot go above the header row");
  const cells = Array.from({ length: table.child(0).childCount }, () => schema.nodes.table_cell.create());
  return tr.insert(rowPos(table, pos, index), schema.nodes.table_row.create(null, cells));
}

/** Deletes body row `index` (1 or more) of the table at `pos`. */
export function deleteTableRow<T extends Transform>(tr: T, pos: number, index: number): T {
  const table = tableAt(tr, pos);
  if (index < 1) throw new Error("The header row cannot be deleted");
  const from = rowPos(table, pos, index);
  return tr.delete(from, from + table.child(index).nodeSize);
}

/** Inserts an empty, unaligned column before column `index` of the table at `pos`; a row too short to reach it is left as it is. */
export function insertTableColumn<T extends Transform>(tr: T, pos: number, index: number): T {
  const table = tableAt(tr, pos);
  for (let k = table.childCount - 1; k >= 0; k--) {
    const row = table.child(k);
    if (row.childCount >= index)
      tr.insert(cellPos(row, rowPos(table, pos, k), index), schema.nodes.table_cell.create());
  }
  const align = [...(table.attrs["align"] as Alignment[])];
  align.splice(index, 0, null);
  return tr.setNodeMarkup(pos, null, { ...table.attrs, align });
}

/**
 * Deletes column `index` of the table at `pos`, which must have another. A row whose only cell is
 * in that column keeps one empty cell, as markdown has no row without cells.
 */
export function deleteTableColumn<T extends Transform>(tr: T, pos: number, index: number): T {
  const table = tableAt(tr, pos);
  if (table.child(0).childCount < 2) throw new Error("The only column of a table cannot be deleted");
  for (let k = table.childCount - 1; k >= 0; k--) {
    const row = table.child(k);
    if (row.childCount <= index) continue;
    const from = cellPos(row, rowPos(table, pos, k), index);
    const cell = row.child(index);
    if (row.childCount > 1) tr.delete(from, from + cell.nodeSize);
    else if (cell.content.size > 0) tr.delete(from + 1, from + 1 + cell.content.size);
  }
  const align = [...(table.attrs["align"] as Alignment[])];
  align.splice(index, 1);
  return tr.setNodeMarkup(pos, null, { ...table.attrs, align });
}

/** Sets the alignment of column `index` of the table at `pos`. */
export function alignTableColumn<T extends Transform>(tr: T, pos: number, index: number, alignment: Alignment): T {
  const table = tableAt(tr, pos);
  const align = [...(table.attrs["align"] as Alignment[])];
  align[index] = alignment;
  return tr.setNodeMarkup(pos, null, { ...table.attrs, align });
}
