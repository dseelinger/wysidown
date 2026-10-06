import { caret, expect, fixture, hostText, load, settled, test } from "./support.ts";

const tasks = fixture("06-task-lists.md");
const nested = fixture("04-lists-nested.md");
const numbered = fixture("23-ordered-numbering.md");

test("Enter at the end of a task adds an unchecked task with the list's marker", async ({ harness: page }) => {
  await load(page, tasks);
  await caret(page, "Write the announcement", "End", "Enter");
  await page.keyboard.type("Draft the post");
  await settled(page);
  expect(await hostText(page)).toBe(
    tasks.replace("- [x] Write the announcement\n", "- [x] Write the announcement\n- [ ] Draft the post\n"),
  );
});

test("Enter in a numbered list counts on, and Enter on the empty item leaves the list", async ({ harness: page }) => {
  await load(page, numbered);
  await caret(page, "eleven", "End", "Enter");
  await page.keyboard.type("twelve");
  await settled(page);
  expect(await hostText(page)).toBe(numbered + "12. twelve\n");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("After the list.");
  await settled(page);
  expect(await hostText(page)).toBe(numbered + "12. twelve\n\nAfter the list.\n");
});

test("Tab nests an item and Shift-Tab moves it back", async ({ harness: page }) => {
  await load(page, nested);
  await caret(page, "Leeks", "End", "Tab");
  await settled(page);
  expect(await hostText(page)).toBe(nested.replace("  - Carrots\n  - Leeks\n", "  - Carrots\n    - Leeks\n"));
  await caret(page, "Leeks", "End", "Shift+Tab");
  await settled(page);
  expect(await hostText(page)).toBe(nested);
});

test("clicking a task's checkbox changes one character and leaves the cursor where it was", async ({
  harness: page,
}) => {
  await load(page, tasks);
  await caret(page, "Tell the mailing list", "End");
  await page
    .getByRole("listitem")
    .filter({ hasText: /^Update the website/ })
    .getByRole("checkbox")
    .first()
    .click();
  await settled(page);
  const checked = tasks.replace("- [ ] Update the website", "- [x] Update the website");
  expect(await hostText(page)).toBe(checked);
  await page.screenshot({ path: "test-results/task-list.png" });
  await page.keyboard.type("!");
  await settled(page);
  expect(await hostText(page)).toBe(checked.replace("mailing list", "mailing list!"));
});

test("Space on a focused checkbox toggles its task", async ({ harness: page }) => {
  await load(page, tasks);
  await page
    .getByRole("listitem")
    .filter({ hasText: /^Tag the release/ })
    .getByRole("checkbox")
    .focus();
  await page.keyboard.press("Space");
  await settled(page);
  expect(await hostText(page)).toBe(tasks.replace("- [X] Tag the release", "- [ ] Tag the release"));
});

test("a tight list shows its items close together and a loose list spaces them", async ({ harness: page }) => {
  await load(page, fixture("05-lists-loose-tight.md"));
  const gap = (list: number) =>
    page
      .locator("ul")
      .nth(list)
      .evaluate((ul) => ul.children[1]!.getBoundingClientRect().top - ul.children[0]!.getBoundingClientRect().bottom);
  expect(await gap(0)).toBe(0);
  expect(await gap(1)).toBeGreaterThan(0);
  await load(page, nested);
  await page.screenshot({ path: "test-results/nested-lists.png" });
});
