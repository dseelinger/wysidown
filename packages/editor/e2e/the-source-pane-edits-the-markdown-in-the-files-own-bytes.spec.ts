import type { Page } from "@playwright/test";
import { expect, fixture, hostText, load, settled, test } from "./support.ts";

const blog = fixture("27-blog-post.md");
const lineEnd = "should be a one-word diff.";

/** Opens the harness with the source pane in place of the editor. */
async function sourcePane(page: Page): Promise<void> {
  await page.goto("/?pane=source");
  await page.waitForFunction(() => "harness" in window);
}

/** Clicks the end of the source line holding `text`. */
async function lineEndOf(page: Page, text: string): Promise<void> {
  await page.locator(".cm-line", { hasText: text }).click();
  await page.keyboard.press("End");
}

test("typing in the source pane sends only the typed bytes, with the file's line endings and byte order mark", async ({
  harness: page,
}) => {
  await sourcePane(page);
  const original = "﻿" + blog.replaceAll("\n", "\r\n");
  await load(page, original);
  await expect(page.locator(".cm-content")).toContainText("`__strong__` turned into `**strong**`");
  await lineEndOf(page, lineEnd);
  await page.keyboard.type(" Really.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Next line.");
  await settled(page);
  expect(await hostText(page)).toBe(original.replace(lineEnd, lineEnd + " Really.\r\nNext line."));
});

test("undo in the source pane restores the host's text", async ({ harness: page }) => {
  await sourcePane(page);
  await load(page, blog);
  await lineEndOf(page, lineEnd);
  await page.keyboard.type(" Really.");
  await settled(page);
  await page.keyboard.press("Control+z");
  await settled(page);
  expect(await hostText(page)).toBe(blog);
});

test("the source pane takes the page's colours in light and dark themes", async ({ harness: page }) => {
  await sourcePane(page);
  await load(page, blog);
  const colours = () =>
    page.locator(".cm-editor").evaluate((el) => {
      const body = getComputedStyle(el.ownerDocument.body);
      const pane = getComputedStyle(el);
      return { pane: [pane.backgroundColor, pane.color], body: [body.backgroundColor, body.color] };
    });
  await page.emulateMedia({ colorScheme: "light" });
  const light = await colours();
  expect(light.pane).toEqual(light.body);
  await page.screenshot({ path: "test-results/source-pane-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await colours();
  expect(dark.pane).toEqual(dark.body);
  expect(dark.pane).not.toEqual(light.pane);
  await page.screenshot({ path: "test-results/source-pane-dark.png" });
});
