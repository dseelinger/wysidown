import { caret, expect, fixture, hostText, inSync, load, settled, test } from "./support.ts";

const aligned = fixture("02-tables-aligned.md");
const containers = fixture("33-tables-in-containers.md");

test("a table shows its header row as column headers and its columns aligned", async ({ harness: page }) => {
  await load(page, aligned);
  const first = page.locator(".ProseMirror table").first();
  await expect(first.getByRole("columnheader")).toHaveText(["Platform", "Arch", "Status", "Size (MB)"]);
  const align = (cell: string) =>
    first.getByText(cell, { exact: true }).evaluate((td) => getComputedStyle(td).textAlign);
  expect(await align("Platform")).toBe("left");
  expect(await align("Arch")).toBe("center");
  expect(await align("Status")).toBe("right");
  await page.locator(".ProseMirror").screenshot({ path: "test-results/tables.png" });
});

test("Tab from the last cell adds a padded row, and Tab moves on through it", async ({ harness: page }) => {
  await load(page, aligned);
  await caret(page, "95.0", "End", "Tab");
  await page.keyboard.type("FreeBSD");
  for (const text of ["x64", "✅", "90.0"]) {
    await page.keyboard.press("Tab");
    await inSync(page);
    await page.keyboard.type(text);
  }
  await settled(page);
  expect(await hostText(page)).toBe(
    aligned.replace(
      "| Linux    | x64   | ✅     | 95.0      |\n",
      "| Linux    | x64   | ✅     | 95.0      |\n| FreeBSD  | x64   | ✅     | 90.0      |\n",
    ),
  );
});

test("Enter moves to the cell below instead of breaking the cell", async ({ harness: page }) => {
  await load(page, containers);
  await caret(page, "fast", "End", "Enter");
  await page.keyboard.type("r");
  await settled(page);
  expect(await hostText(page)).toBe(containers.replace("| safe |", "| safer |"));
});

test("right-clicking a cell opens the table menu, which adds a column beside it", async ({ harness: page }) => {
  await load(page, containers);
  await page.getByText("off", { exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Table" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Delete row" })).toBeEnabled();
  await page.screenshot({ path: "test-results/table-menu.png" });
  await menu.getByRole("menuitem", { name: "Insert column right" }).click();
  await expect(menu).toBeHidden();
  await page.keyboard.type("on");
  await settled(page);
  expect(await hostText(page)).toBe(
    containers
      .replace("> | Option    | Default |\n", "> | Option    | Default |     |\n")
      .replace("> | --------- | ------- |\n", "> | --------- | ------- | --- |\n")
      .replace("> | `--watch` | off     |  \n", "> | `--watch` | off     | on  |  \n")
      .replace("> | `--port`  | 8080    |\n", "> | `--port`  | 8080    |     |\n"),
  );
});

test("the menu key opens the table menu at the cursor, and it is used from the keyboard", async ({ harness: page }) => {
  await load(page, containers);
  await caret(page, "東京", "End", "Shift+F10");
  const menu = page.getByRole("menu", { name: "Table" });
  await expect(menu.getByRole("menuitem", { name: "Insert row above" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Delete row" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await settled(page);
  expect(await hostText(page)).toBe(containers.replace("| 東京 | 首都     |\n", ""));
  await page.keyboard.type("!");
  await settled(page);
  expect(await hostText(page)).toBe(containers.replace("| 東京 | 首都     |\n", "").replace("| 大阪 |", "| 大阪! |"));
});

test("the table menu does not offer to add a row above the header or delete it", async ({ harness: page }) => {
  await load(page, containers);
  await page.getByText("名前", { exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Table" });
  await expect(menu.getByRole("menuitem", { name: "Insert row above" })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "Delete row" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("aligning a column from the menu changes its delimiter cell and how it shows", async ({ harness: page }) => {
  await load(page, containers);
  await page.getByText("首都", { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Align right" }).click();
  await settled(page);
  expect(await hostText(page)).toBe(containers.replace("| ---- | -------- |", "| ---- | -------: |"));
  expect(await page.getByText("首都", { exact: true }).evaluate((td) => getComputedStyle(td).textAlign)).toBe("right");
});
