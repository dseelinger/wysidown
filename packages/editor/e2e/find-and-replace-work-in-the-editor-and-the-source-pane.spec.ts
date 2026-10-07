import type { Page } from "@playwright/test";
import { caret, expect, fixture, hostText, inSync, load, settled, test } from "./support.ts";

const blog = fixture("27-blog-post.md");
/** The blog post with every "diff" the editor shows replaced by "change"; the image's alt text, title and path keep theirs. */
const blogChanged = blog
  .replace("the diff shows", "the change shows")
  .replace("one-word diff.", "one-word change.")
  .replace("best diff", "best change");

function bar(page: Page) {
  return page.getByRole("dialog", { name: "Find and replace" });
}

/** Selects the first occurrence of `text` in the editor, which must lie in one text node. */
async function select(page: Page, text: string): Promise<void> {
  await page.locator(".ProseMirror").focus();
  await page.evaluate((find) => {
    const walker = document.createTreeWalker(document.querySelector(".ProseMirror")!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(find);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + find.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error(`"${find}" is not in the editor`);
  }, text);
  await inSync(page);
}

/** Opens the harness with the source pane in place of the editor. */
async function sourcePane(page: Page): Promise<void> {
  await page.goto("/?pane=source");
  await page.waitForFunction(() => "harness" in window);
}

test("Ctrl+F opens the bar with the selected word, counts matches and steps through them", async ({
  harness: page,
}) => {
  await load(page, blog);
  await select(page, "diff");
  await expect(bar(page)).toBeHidden();
  await page.keyboard.press("Control+f");
  const find = bar(page).getByRole("textbox", { name: "Find" });
  await expect(bar(page)).toBeVisible();
  await expect(find).toBeFocused();
  await expect(find).toHaveValue("diff");
  await expect(bar(page)).toContainText("1 of 3");
  await expect(page.locator(".ProseMirror .ProseMirror-search-match")).toHaveCount(2);
  await expect(page.locator(".ProseMirror .ProseMirror-active-search-match")).toHaveText("diff");
  await expect(bar(page).getByRole("textbox", { name: "Replace" })).toBeHidden();
  await page.screenshot({ path: "test-results/find-bar.png" });

  await page.keyboard.press("Enter");
  await expect(bar(page)).toContainText("2 of 3");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(bar(page)).toContainText("1 of 3");
  await page.keyboard.press("Shift+Enter");
  await expect(bar(page)).toContainText("3 of 3");
  await page.keyboard.press("F3");
  await expect(bar(page)).toContainText("1 of 3");
  await page.keyboard.press("Shift+F3");
  await expect(bar(page)).toContainText("3 of 3");

  await find.fill("nothing like this");
  await expect(bar(page)).toContainText("No results");
  await find.fill("diff");
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeHidden();
  await expect(page.locator(".ProseMirror")).toBeFocused();
  await expect(page.locator(".ProseMirror-search-match, .ProseMirror-active-search-match")).toHaveCount(0);
  await settled(page);
  expect(await hostText(page)).toBe(blog);
});

test("Replace All in the editor changes only the matched bytes and is undone in one step", async ({
  harness: page,
}) => {
  await load(page, blog);
  await caret(page, "That makes review painful.");
  await page.keyboard.press("Control+h");
  const find = bar(page).getByRole("textbox", { name: "Find" });
  const replace = bar(page).getByRole("textbox", { name: "Replace" });
  await expect(find).toBeFocused();
  await page.keyboard.type("Diff");
  await page.keyboard.press("Alt+w");
  await expect(bar(page).getByRole("button", { name: "Match Whole Word" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar(page)).toContainText("of 3");
  await page.keyboard.press("Alt+c");
  await expect(bar(page)).toContainText("No results");
  await page.keyboard.press("Alt+c");
  await replace.fill("change");
  await page.screenshot({ path: "test-results/find-bar-replace.png" });
  await page.keyboard.press("Control+Alt+Enter");
  await settled(page);
  expect(await hostText(page)).toBe(blogChanged);
  await expect(bar(page)).toContainText("No results");

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await settled(page);
  expect(await hostText(page)).toBe(blog);
});

test("Replace replaces one match at a time, and a regular expression's replacement may use $1", async ({
  harness: page,
}) => {
  await load(page, blog);
  await caret(page, 'What "fidelity" means');
  await page.keyboard.press("Control+h");
  await page.keyboard.type("(\\w+) you did");
  await page.keyboard.press("Alt+r");
  await expect(bar(page).getByRole("button", { name: "Use Regular Expression" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(bar(page)).toContainText("1 of 2");
  const replace = bar(page).getByRole("textbox", { name: "Replace" });
  await replace.fill("$1 we did");
  await replace.press("Enter");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace("Text you did not", "Text we did not"));
  await expect(bar(page)).toContainText("1 of 1");
  await page.keyboard.press("Control+Shift+1");
  await settled(page);
  expect(await hostText(page)).toBe(
    blog.replace("Text you did not", "Text we did not").replace("Text you did touch", "Text we did touch"),
  );
});

test("a replacement reaches a host that owns undo apart from the typing before it", async ({ harness: page }) => {
  await page.goto("/?undo=host");
  await page.waitForFunction(() => "harness" in window);
  await load(page, blog);
  await caret(page, "That makes review painful.");
  await page.keyboard.press("Control+h");
  await page.keyboard.type("Really");
  await bar(page).getByRole("textbox", { name: "Replace" }).fill("Again");
  await caret(page, "That makes review painful.", "End");
  await page.keyboard.type(" Really");
  await expect(bar(page)).toContainText("of 1");
  await bar(page).getByRole("button", { name: "Replace All" }).click();
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace("one-word diff.", "one-word diff. Again"));
  const edits = await page.evaluate(() =>
    window.harness.messages.flatMap((m) => (m.type === "edit" ? [m.edits.map((e) => e.insert)] : [])),
  );
  expect(edits).toEqual([[" Really"], ["Again"]]);
});

test("find and Replace All in the source pane change only the matched bytes, in the file's line endings", async ({
  harness: page,
}) => {
  await sourcePane(page);
  const original = "﻿" + blog.replaceAll("\n", "\r\n");
  await load(page, original);
  await page.locator(".cm-line", { hasText: "That makes review painful." }).click();
  await page.keyboard.press("Control+h");
  await page.keyboard.type("diff");
  await page.keyboard.press("Alt+w");
  await expect(bar(page)).toContainText("of 6");
  await expect(page.locator(".cm-searchMatch")).toHaveCount(6);
  await expect(page.locator(".cm-searchMatch-selected")).toHaveCount(1);
  const colours = await page
    .locator(".cm-searchMatch")
    .evaluateAll((spans) => spans.map((s) => getComputedStyle(s).backgroundColor));
  expect(new Set(colours).size).toBe(2);
  expect(colours).toContain("rgba(234, 92, 0, 0.333)");
  await page.screenshot({ path: "test-results/find-bar-source.png" });
  await bar(page).getByRole("textbox", { name: "Replace" }).fill("change");
  await bar(page).getByRole("button", { name: "Replace All" }).click();
  await settled(page);
  expect(await hostText(page)).toBe(original.replaceAll("diff", "change"));
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeHidden();
  await expect(page.locator(".cm-searchMatch")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await settled(page);
  expect(await hostText(page)).toBe(original);
});
