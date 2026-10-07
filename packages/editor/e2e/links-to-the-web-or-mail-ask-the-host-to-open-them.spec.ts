import type { Locator, Page } from "@playwright/test";
import { expect, fixture, hostText, inSync, load, settled, test } from "./support.ts";

/** The targets of the `open` messages the editor sent. */
async function opened(page: Page): Promise<string[]> {
  await settled(page);
  const messages = await page.evaluate(() => window.harness.messages);
  return messages.flatMap((m) => (m.type === "open" ? [m.href] : []));
}

/** The link whose whole text is `text`. */
function linkNamed(page: Page, text: string): Locator {
  return page.locator("a").and(page.getByText(text, { exact: true }));
}

test("Ctrl+click on a link to the web asks the host to open its address", async ({ harness: page }) => {
  const doc = fixture("35-inline-links.md");
  await load(page, doc);
  await linkNamed(page, "the docs").click({ modifiers: ["Control"] });
  expect(await opened(page)).toEqual(["https://example.com/docs"]);
  expect(await hostText(page)).toBe(doc);
});

test("Open on a mail link asks the host to open its address", async ({ harness: page }) => {
  const doc = fixture("10-autolinks.md");
  await load(page, doc);
  await linkNamed(page, "someone@example.com").click();
  await inSync(page);
  const popover = page.getByRole("dialog", { name: "Link" });
  await popover.getByRole("button", { name: "Open" }).click();
  expect(await opened(page)).toEqual(["mailto:someone@example.com"]);
  expect(await hostText(page)).toBe(doc);
});

test("Ctrl+click on a reference link asks the host to open its definition's address", async ({ harness: page }) => {
  await load(page, fixture("09-reference-links.md"));
  await linkNamed(page, "guide").click({ modifiers: ["Control"] });
  await linkNamed(page, "THE FAQ").click({ modifiers: ["Control"] });
  expect(await opened(page)).toEqual(["https://example.com/guide", "https://example.com/faq"]);
});

test("a link with any other scheme has no Open button, and Ctrl+click asks the host for nothing", async ({
  harness: page,
}) => {
  const doc =
    "[run](javascript:alert(1)), [notepad](file:///C:/Windows/notepad.exe) and [settings](ms-settings:privacy).\n";
  await load(page, doc);
  const popover = page.getByRole("dialog", { name: "Link" });
  for (const text of ["run", "notepad", "settings"]) {
    await linkNamed(page, text).click();
    await inSync(page);
    await expect(popover.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(popover.getByRole("button", { name: "Open" })).toBeHidden();
    await linkNamed(page, text).click({ modifiers: ["Control"] });
  }
  expect(await opened(page)).toEqual([]);
  expect(await hostText(page)).toBe(doc);
});
