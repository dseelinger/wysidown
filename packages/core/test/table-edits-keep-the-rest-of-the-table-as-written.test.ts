import type { Node } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../src/markdown/parse.ts";
import { schema } from "../src/markdown/schema.ts";
import { serializeMarkdown } from "../src/markdown/serialize.ts";
import {
  alignTableColumn,
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
} from "../src/markdown/tables.ts";
import { fixtures } from "./support/corpus.ts";

const aligned = fixtures("realistic").find((f) => f.name === "02-tables-aligned.md")!.text;
const containers = fixtures("realistic").find((f) => f.name === "33-tables-in-containers.md")!.text;

/** The position of the `index`-th table of `doc`. */
function tableAt(doc: Node, index = 0): number {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "table") found.push(pos);
    return !node.isTextblock;
  });
  return found[index]!;
}

/** The position inside cell `column` of row `row` of the table at `table`. */
function cellAt(doc: Node, table: number, row: number, column: number): number {
  let pos = table + 1;
  const t = doc.nodeAt(table)!;
  for (let k = 0; k < row; k++) pos += t.child(k).nodeSize;
  pos += 1;
  for (let k = 0; k < column; k++) pos += t.child(row).child(k).nodeSize;
  return pos + 1;
}

function save(input: string, edit: (tr: Transform) => Transform): string {
  const source = parseMarkdown(input);
  const result = serializeMarkdown(source, edit(new Transform(source.doc)).doc);
  expect(result.verified).toBe(true);
  return result.text;
}

describe("table edits keep the rest of the table as written", () => {
  test("a row added to a padded table is padded to its columns", () => {
    const output = save(aligned, (tr) => {
      const table = tableAt(tr.doc);
      insertTableRow(tr, table, 5);
      ["FreeBSD", "x64", "✅", "90.0"].forEach((text, k) => {
        tr.insert(cellAt(tr.doc, table, 5, k), schema.text(text));
      });
      return tr;
    });
    expect(output).toBe(
      aligned.replace(
        "| Linux    | x64   | ✅     | 95.0      |\n",
        "| Linux    | x64   | ✅     | 95.0      |\n| FreeBSD  | x64   | ✅     | 90.0      |\n",
      ),
    );
  });

  test("a row added to a table without outer pipes has none, and a row with empty cells at its ends has them", () => {
    const filled = save(aligned, (tr) => {
      const table = tableAt(tr.doc, 2);
      insertTableRow(tr, table, 3);
      tr.insert(cellAt(tr.doc, table, 3, 1), schema.text("2"));
      return tr.insert(cellAt(tr.doc, table, 3, 0), schema.text("gamma"));
    });
    expect(filled).toBe(aligned.replace("beta | 2\n", "beta | 2\ngamma | 2\n"));
    const empty = save(aligned, (tr) => insertTableRow(tr, tableAt(tr.doc, 2), 3));
    expect(empty).toBe(aligned.replace("beta | 2\n", "beta | 2\n| | |\n"));
  });

  test("a row added inside a blockquote or list item takes its prefix", () => {
    const output = save(containers, (tr) =>
      insertTableRow(insertTableRow(tr, tableAt(tr.doc, 1), 3), tableAt(tr.doc), 3),
    );
    expect(output).toBe(
      containers
        .replace("> | `--port`  | 8080    |\n", "> | `--port`  | 8080    |\n> |           |         |\n")
        .replace("   | safe |  | runs every check |\n", "   | safe |  | runs every check |\n   | | | |\n"),
    );
  });

  test("a deleted row takes only its own line", () => {
    const output = save(containers, (tr) => deleteTableRow(tr, tableAt(tr.doc), 1));
    expect(output).toBe(containers.replace("> | `--watch` | off     |  \n", ""));
  });

  test("a row edited after the row above it was deleted keeps its own padding", () => {
    const output = save(containers, (tr) => {
      const table = tableAt(tr.doc, 3);
      deleteTableRow(tr, table, 1);
      return tr.insert(cellAt(tr.doc, table, 1, 0) + "大阪".length, schema.text("!"));
    });
    expect(output).toBe(containers.replace("| 東京 | 首都     |\n| 大阪 |", "| 大阪! |"));
  });

  test("a column added to a padded table is padded in every row, delimiter included", () => {
    const output = save(aligned, (tr) => insertTableColumn(tr, tableAt(tr.doc), 4));
    const lines = output.split("\n").slice(2, 8);
    expect(lines).toEqual([
      "| Platform | Arch  | Status | Size (MB) |     |",
      "|:---------|:-----:|-------:|----------:|-----|",
      "| Windows  | x64   | ✅     | 92.4      |     |",
      "| Windows  | arm64 | ⚠️     | 88.1      |     |",
      "| macOS    | arm64 | ❌     | —         |     |",
      "| Linux    | x64   | ✅     | 95.0      |     |",
    ]);
  });

  test("a deleted column takes its cells and their pipes, and leaves the rows that do not reach it", () => {
    const ragged = "| Short | Long |\n| :-- | --: |\n| 1 | 2 |\n| 3 |\n";
    expect(save(ragged, (tr) => deleteTableColumn(tr, 0, 1))).toBe("| Short |\n| :-- |\n| 1 |\n| 3 |\n");
    expect(save(ragged, (tr) => deleteTableColumn(tr, 0, 0))).toBe("| Long |\n| --: |\n| 2 |\n|  |\n");
  });

  test("changing a column's alignment changes only its delimiter cell, keeping its width", () => {
    const output = save(aligned, (tr) => alignTableColumn(tr, tableAt(tr.doc), 0, "right"));
    expect(output).toBe(aligned.replace("|:---------|:-----:|", "|---------:|:-----:|"));
  });

  test("text typed into an empty cell goes between its pipes with a space each side", () => {
    const output = save(containers, (tr) => tr.insert(cellAt(tr.doc, tableAt(tr.doc, 2), 1, 0), schema.text("x")));
    expect(output).toBe(containers.replace("| | middle | |", "| x | middle | |"));
  });

  test("a pipe typed into a cell is escaped, and so is one in a rewritten code span", () => {
    const typed = save(aligned, (tr) => {
      const cell = cellAt(tr.doc, tableAt(tr.doc, 2), 1, 0);
      return tr.insert(cell + "alpha".length, schema.text("|"));
    });
    expect(typed).toBe(aligned.replace("alpha | 1", "alpha\\| | 1"));
    const code = "| `a \\| b` and c |\n| --- |\n";
    const bolded = save(code, (tr) => {
      const and = cellAt(tr.doc, 0, 0, 0) + "a | b ".length;
      return tr.addMark(and, and + "and".length, schema.marks.strong.create());
    });
    expect(bolded).toBe("| `a \\| b` **and** c |\n| --- |\n");
  });

  test("the header row stays first", () => {
    const tr = new Transform(parseMarkdown(aligned).doc);
    expect(() => insertTableRow(tr, tableAt(tr.doc), 0)).toThrow();
    expect(() => deleteTableRow(tr, tableAt(tr.doc), 0)).toThrow();
  });
});
