import type { Page } from "@playwright/test";
import { caret, expect, hostText, load, settled, test } from "./support.ts";

const sample = [
  "```ts",
  "const answer: number = 42; // the answer",
  'console.log("hello");',
  "```",
  "",
  "```klingon",
  "const answer = 42;",
  "```",
  "",
].join("\n");

/** The computed colour of the element holding `text` inside a code block. */
async function colour(page: Page, text: string): Promise<string> {
  return page
    .locator(".code-block .hljs-keyword, .code-block [class^='hljs-']", { hasText: text })
    .first()
    .evaluate((el) => getComputedStyle(el).color);
}

test("tokens of a known language are coloured and an unknown language stays plain", async ({ harness: page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await load(page, sample);
  const keyword = await colour(page, "const");
  expect(keyword).not.toBe("rgb(0, 0, 0)");
  expect(await colour(page, '"hello"')).not.toBe(keyword);
  expect(await page.locator(".code-block").nth(1).locator("[class^='hljs-']").count()).toBe(0);
  await page.screenshot({ path: "test-results/highlight-light.png" });
});

test("the token colours differ between light and dark themes", async ({ harness: page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await load(page, sample);
  const light = await colour(page, "const");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await colour(page, "const")).not.toBe(light);
  await page.screenshot({ path: "test-results/highlight-dark.png" });
});

test("in a high contrast theme tokens keep the text colour", async ({ harness: page }) => {
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
  await load(page, sample);
  expect(await colour(page, "const")).toBe(await page.evaluate(() => getComputedStyle(document.body).color));
});

test("typing in a highlighted block updates the colours and saves only the typed bytes", async ({ harness: page }) => {
  await load(page, sample);
  await caret(page, '"hello"', "Home");
  await page.keyboard.type("let ");
  await settled(page);
  expect(await hostText(page)).toBe(sample.replace("console.log", "let console.log"));
  await expect(page.locator(".code-block .hljs-keyword", { hasText: "let" })).toHaveCount(1);
});
