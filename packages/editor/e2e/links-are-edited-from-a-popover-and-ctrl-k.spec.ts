import type { Page } from "@playwright/test";
import { caret, expect, fixture, hostText, inSync, load, settled, test } from "./support.ts";

const links = fixture("35-inline-links.md");
const references = fixture("09-reference-links.md");

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

test("the caret in a link shows its target under it", async ({ harness: page }) => {
  await load(page, links);
  const popover = page.getByRole("dialog", { name: "Link" });
  await expect(popover).toBeHidden();
  await caret(page, "the docs");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("https://example.com/docs");
  await expect(popover.getByRole("button", { name: "Edit" })).toBeVisible();
  await page.screenshot({ path: "test-results/link-popover.png" });
  await caret(page, "Inline links");
  await expect(popover).toBeHidden();
});

test("a target edited in the popover replaces only the destination", async ({ harness: page }) => {
  await load(page, links);
  await caret(page, "style guide");
  const popover = page.getByRole("dialog", { name: "Link" });
  await popover.getByRole("button", { name: "Edit" }).click();
  const url = popover.getByRole("textbox", { name: "URL" });
  await expect(url).toBeFocused();
  await expect(url).toHaveValue("./STYLE.md");
  await expect(popover.getByRole("textbox", { name: "Text" })).toHaveValue("style guide");
  await page.screenshot({ path: "test-results/link-form.png" });
  await url.fill("./docs/STYLE.md");
  await page.keyboard.press("Enter");
  await settled(page);
  expect(await hostText(page)).toBe(links.replace("(./STYLE.md 'House style')", "(./docs/STYLE.md 'House style')"));
  await expect(popover).toContainText("./docs/STYLE.md");
});

test("Ctrl+K on selected text links it, keeping the text as written", async ({ harness: page }) => {
  await load(page, links);
  await select(page, "setup");
  await page.keyboard.press("Control+k");
  const url = page.getByRole("dialog", { name: "Link" }).getByRole("textbox", { name: "URL" });
  await expect(url).toBeFocused();
  await page.keyboard.type("https://example.com/setup");
  await page.keyboard.press("Enter");
  await settled(page);
  expect(await hostText(page)).toBe(links.replace("for setup,", "for [setup](https://example.com/setup),"));
});

test("Escape closes the form without changing the link", async ({ harness: page }) => {
  await load(page, links);
  await caret(page, "the docs");
  await page.keyboard.press("Control+k");
  const popover = page.getByRole("dialog", { name: "Link" });
  await popover.getByRole("textbox", { name: "URL" }).fill("https://example.com/other");
  await page.keyboard.press("Escape");
  await expect(popover.getByRole("textbox", { name: "URL" })).toBeHidden();
  await expect(popover).toContainText("https://example.com/docs");
  await settled(page);
  expect(await hostText(page)).toBe(links);
});

test("Remove takes the link off and keeps its text as written", async ({ harness: page }) => {
  await load(page, links);
  await caret(page, "bold");
  await page.getByRole("dialog", { name: "Link" }).getByRole("button", { name: "Remove" }).click();
  await settled(page);
  expect(await hostText(page)).toBe(
    links.replace("[**bold** and *em*](https://example.com/format)", "**bold** and *em*"),
  );
});

test("a reference link's target is edited in its definition", async ({ harness: page }) => {
  await load(page, references);
  await page.getByText("guide", { exact: true }).click();
  await inSync(page);
  const popover = page.getByRole("dialog", { name: "Link" });
  await expect(popover).toContainText("https://example.com/guide");
  await page.keyboard.press("Control+k");
  await popover.getByRole("textbox", { name: "URL" }).fill("https://example.org/guide");
  await page.keyboard.press("Enter");
  await settled(page);
  expect(await hostText(page)).toBe(
    references.replace(
      '[guide]: https://example.com/guide "The Guide"',
      '[guide]: https://example.org/guide "The Guide"',
    ),
  );
});
