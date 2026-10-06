import { caret, expect, fixture, saveUntil, test } from "./support.ts";

const nested = fixture("04-lists-nested.md");
const tasks = fixture("06-task-lists.md");

test("Tab nests an item and Shift+Tab moves it back, with focus kept in the editor", async ({ open }) => {
  const o = await open("04-lists-nested.md");
  await caret(o, "Leeks", "End", "Tab");
  expect(await o.editor.evaluate(() => document.activeElement?.classList.contains("ProseMirror"))).toBe(true);
  await saveUntil(o, nested.replace("  - Leeks\n", "    - Leeks\n"));
  await caret(o, "Leeks", "End", "Shift+Tab");
  await saveUntil(o, nested);
});

test("Enter adds an item with the list's marker", async ({ open }) => {
  const o = await open("04-lists-nested.md");
  await caret(o, "Pears", "End", "Enter");
  await o.window.keyboard.type("Plums");
  await saveUntil(o, nested.replace("  - Pears\n", "  - Pears\n  - Plums\n"));
});

test("clicking a task's checkbox changes one character", async ({ open }) => {
  const o = await open("06-task-lists.md");
  await o.editor
    .getByRole("listitem")
    .filter({ hasText: /^Update the website/ })
    .getByRole("checkbox")
    .first()
    .click();
  await saveUntil(o, tasks.replace("- [ ] Update the website", "- [x] Update the website"));
});
