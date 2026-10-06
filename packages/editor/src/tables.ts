import {
  alignTableColumn,
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  schema,
  type Alignment,
} from "@wysidown/core";
import { Fragment, Slice, type Node, type ResolvedPos } from "prosemirror-model";
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

/** Where a table cell is: the position of its table, and its row and column. */
export interface CellPlace {
  table: number;
  row: number;
  column: number;
}

/** The table cell that holds `$pos`, or null. */
export function cellAt($pos: ResolvedPos): CellPlace | null {
  for (let d = $pos.depth; d >= 3; d--) {
    if ($pos.node(d).type === schema.nodes.table_cell)
      return { table: $pos.before(d - 2), row: $pos.index(d - 2), column: $pos.index(d - 1) };
  }
  return null;
}

/** The position of the start of the content of cell `column` of row `row`, clamped to the row's last cell. */
function cellStart(doc: Node, table: number, row: number, column: number): number {
  const t = doc.nodeAt(table)!;
  let at = table + 2;
  for (let k = 0; k < row; k++) at += t.child(k).nodeSize;
  const r = t.child(row);
  const last = Math.min(column, r.childCount - 1);
  for (let k = 0; k < last; k++) at += r.child(k).nodeSize;
  return at + 1;
}

/** Puts the cursor at the end of a cell's content. */
function toCell(tr: Transaction, table: number, row: number, column: number): Transaction {
  const start = cellStart(tr.doc, table, row, column);
  const cell = tr.doc.resolve(start).parent;
  return tr.setSelection(TextSelection.create(tr.doc, start + cell.content.size)).scrollIntoView();
}

/** A command that runs `edit` on the cell holding the selection; false outside a table. */
function inCell(edit: (state: EditorState, place: CellPlace, table: Node) => Transaction | null): Command {
  return (state, dispatch) => {
    const place = cellAt(state.selection.$from);
    if (!place) return false;
    const tr = edit(state, place, state.doc.nodeAt(place.table)!);
    if (!tr) return false;
    dispatch?.(tr);
    return true;
  };
}

/** Moves to the next cell; from the last cell, adds a row and moves to its first cell. */
export const nextCell = inCell((state, { table, row, column }, t) => {
  if (column + 1 < t.child(row).childCount) return toCell(state.tr, table, row, column + 1);
  if (row + 1 < t.childCount) return toCell(state.tr, table, row + 1, 0);
  return toCell(insertTableRow(state.tr, table, row + 1), table, row + 1, 0);
});

/** Moves to the previous cell; in the first cell, stays there. */
export const previousCell = inCell((state, { table, row, column }, t) => {
  if (column > 0) return toCell(state.tr, table, row, column - 1);
  if (row > 0) return toCell(state.tr, table, row - 1, t.child(row - 1).childCount - 1);
  return state.tr;
});

/** Moves to the cell below; from the last row, adds a row and moves into it. */
export const cellBelow = inCell((state, { table, row, column }, t) => {
  const tr = row + 1 < t.childCount ? state.tr : insertTableRow(state.tr, table, row + 1);
  return toCell(tr, table, row + 1, column);
});

/** Keeps Backspace at the start of a cell and Delete at its end from merging it with its neighbour. */
function atCellEdge(end: boolean): Command {
  return (state) => {
    const { $from, empty } = state.selection;
    if (!empty || !cellAt($from)) return false;
    return end ? $from.parentOffset === $from.parent.content.size : $from.parentOffset === 0;
  };
}

/** Adds an empty row above or below the cursor's row; not above the header row. */
export function addRow(where: "above" | "below"): Command {
  return inCell((state, { table, row, column }) => {
    const index = where === "above" ? row : row + 1;
    if (index < 1) return null;
    return toCell(insertTableRow(state.tr, table, index), table, index, column);
  });
}

/** Deletes the cursor's row; not the header row. */
export const deleteRow = inCell((state, { table, row, column }, t) => {
  if (row < 1) return null;
  const tr = deleteTableRow(state.tr, table, row);
  return toCell(tr, table, Math.min(row, t.childCount - 2), column);
});

/** Adds an empty column left or right of the cursor's column. */
export function addColumn(where: "left" | "right"): Command {
  return inCell((state, { table, row, column }, t) => {
    const index = where === "left" ? column : column + 1;
    if (index > t.child(0).childCount) return null;
    return toCell(insertTableColumn(state.tr, table, index), table, row, index);
  });
}

/** Deletes the cursor's column; not a table's only column. */
export const deleteColumn = inCell((state, { table, row, column }, t) => {
  if (t.child(0).childCount < 2 || column >= t.child(0).childCount) return null;
  return toCell(deleteTableColumn(state.tr, table, column), table, row, Math.max(0, column - 1));
});

/** Sets the alignment of the cursor's column. */
export function alignColumn(alignment: Alignment): Command {
  return inCell((state, { table, column }, t) => {
    if (column >= t.child(0).childCount) return null;
    if ((t.attrs["align"] as Alignment[])[column] === alignment) return state.tr;
    return alignTableColumn(state.tr, table, column, alignment);
  });
}

export const tableKeys: Record<string, Command> = {
  Tab: nextCell,
  "Shift-Tab": previousCell,
  Enter: cellBelow,
  "Shift-Enter": cellBelow,
  Backspace: atCellEdge(false),
  Delete: atCellEdge(true),
};

/** Header cells, and cells of aligned columns, as decorations. */
function decorate(doc: Node): DecorationSet {
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== schema.nodes.table) return !node.isTextblock;
    const align = node.attrs["align"] as Alignment[];
    node.forEach((row, rowOffset, r) => {
      row.forEach((cell, cellOffset, c) => {
        const from = pos + 1 + rowOffset + 1 + cellOffset;
        const attrs: Record<string, string> = r === 0 ? { class: "header", role: "columnheader" } : {};
        const a = align[c];
        if (a) attrs["style"] = `text-align: ${a}`;
        if (Object.keys(attrs).length > 0) found.push(Decoration.node(from, from + cell.nodeSize, attrs));
      });
    });
    return false;
  });
  return DecorationSet.create(doc, found);
}

/** Content pasted or dropped into a cell, as one line: blocks are joined by a space and line breaks become spaces. */
export function oneLine(slice: Slice): Slice {
  const inline: Node[] = [];
  const add = (node: Node) => {
    inline.push(node.type === schema.nodes.hard_break ? schema.text(" ") : node);
  };
  const block = (node: Node): boolean => {
    if (!node.isTextblock) return true;
    if (inline.length > 0 && node.content.size > 0) inline.push(schema.text(" "));
    node.forEach(add);
    return false;
  };
  slice.content.forEach((node) => {
    if (node.isInline) add(node);
    else if (block(node)) node.descendants(block);
  });
  return new Slice(Fragment.fromArray(inline), 0, 0);
}

interface MenuItem {
  label: string;
  command: Command;
}

const menuItems: (MenuItem | null)[] = [
  { label: "Insert row above", command: addRow("above") },
  { label: "Insert row below", command: addRow("below") },
  { label: "Delete row", command: deleteRow },
  null,
  { label: "Insert column left", command: addColumn("left") },
  { label: "Insert column right", command: addColumn("right") },
  { label: "Delete column", command: deleteColumn },
  null,
  { label: "Align left", command: alignColumn("left") },
  { label: "Align center", command: alignColumn("center") },
  { label: "Align right", command: alignColumn("right") },
  { label: "No alignment", command: alignColumn(null) },
];

/** The menu a right-click or the menu key opens on a table cell. */
class TableMenu {
  readonly #view: EditorView;
  readonly #dom: HTMLElement;
  readonly #buttons: { button: HTMLButtonElement; item: MenuItem }[] = [];
  readonly #closeOutside = (event: Event) => {
    if (!this.#dom.contains(event.target as globalThis.Node)) this.close();
  };
  readonly #close = () => {
    this.close();
  };
  readonly #escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
    this.#view.focus();
  };

  constructor(view: EditorView) {
    this.#view = view;
    const document = view.dom.ownerDocument;
    this.#dom = document.createElement("div");
    this.#dom.className = "table-menu";
    this.#dom.setAttribute("role", "menu");
    this.#dom.setAttribute("aria-label", "Table");
    this.#dom.hidden = true;
    for (const item of menuItems) {
      if (!item) {
        this.#dom.appendChild(document.createElement("hr")).setAttribute("role", "separator");
        continue;
      }
      const button = this.#dom.appendChild(document.createElement("button"));
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = item.label;
      button.addEventListener("click", () => {
        this.close();
        item.command(this.#view.state, this.#view.dispatch);
        this.#view.focus();
      });
      this.#buttons.push({ button, item });
    }
    this.#dom.addEventListener("keydown", (event) => {
      this.#key(event);
    });
    document.body.appendChild(this.#dom);
  }

  /** Opens the menu at a point of the window, for the cell holding the selection. */
  open(left: number, top: number, focus: boolean): void {
    for (const { button, item } of this.#buttons) button.disabled = !item.command(this.#view.state);
    this.#dom.hidden = false;
    const window = this.#dom.ownerDocument.defaultView!;
    const { width, height } = this.#dom.getBoundingClientRect();
    this.#dom.style.left = `${String(Math.max(0, Math.min(left, window.innerWidth - width)))}px`;
    this.#dom.style.top = `${String(Math.max(0, Math.min(top, window.innerHeight - height)))}px`;
    const document = this.#dom.ownerDocument;
    document.addEventListener("mousedown", this.#closeOutside, true);
    document.addEventListener("keydown", this.#escape, true);
    window.addEventListener("blur", this.#close);
    window.addEventListener("resize", this.#close);
    document.addEventListener("scroll", this.#close, true);
    if (focus) this.#enabled()[0]?.focus();
  }

  close(): void {
    if (this.#dom.hidden) return;
    this.#dom.hidden = true;
    const document = this.#dom.ownerDocument;
    const window = document.defaultView!;
    document.removeEventListener("mousedown", this.#closeOutside, true);
    document.removeEventListener("keydown", this.#escape, true);
    window.removeEventListener("blur", this.#close);
    window.removeEventListener("resize", this.#close);
    document.removeEventListener("scroll", this.#close, true);
  }

  destroy(): void {
    this.close();
    this.#dom.remove();
  }

  #enabled(): HTMLButtonElement[] {
    return this.#buttons.map((b) => b.button).filter((b) => !b.disabled);
  }

  #key(event: KeyboardEvent): void {
    const enabled = this.#enabled();
    const at = enabled.indexOf(this.#dom.ownerDocument.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      enabled[(to + enabled.length) % enabled.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at < 0 ? -1 : at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(-1);
    else if (event.key === "Tab") {
      event.preventDefault();
      this.close();
      this.#view.focus();
    }
  }
}

/** Shows header cells and column alignment, keeps pasted content to one line in a cell, and opens the table menu. */
export function tables(): Plugin {
  let menu: TableMenu | null = null;
  return new Plugin<DecorationSet>({
    state: {
      init: (_, state) => decorate(state.doc),
      apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
      transformPasted(slice, view) {
        return cellAt(view.state.selection.$from) ? oneLine(slice) : slice;
      },
      handleDOMEvents: {
        contextmenu(view, event) {
          if (!menu || !view.editable) return false;
          const fromKeyboard = event.button !== 2;
          if (!fromKeyboard) {
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!at || !cellAt(view.state.doc.resolve(at.pos))) return false;
            const { from, to } = view.state.selection;
            if (at.pos < from || at.pos > to)
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at.pos)));
          } else if (!cellAt(view.state.selection.$from)) {
            return false;
          }
          event.preventDefault();
          const caret = view.coordsAtPos(view.state.selection.head);
          menu.open(
            fromKeyboard ? caret.left : event.clientX,
            fromKeyboard ? caret.bottom : event.clientY,
            fromKeyboard,
          );
          return true;
        },
      },
    },
    view(view) {
      menu = new TableMenu(view);
      return {
        update(_, previous) {
          if (!view.state.doc.eq(previous.doc)) menu?.close();
        },
        destroy() {
          menu?.destroy();
          menu = null;
        },
      };
    },
  });
}
