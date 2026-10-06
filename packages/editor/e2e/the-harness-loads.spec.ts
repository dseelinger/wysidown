import { expect, test } from "@playwright/test";

test("the harness page loads with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("ready");
  expect(errors).toEqual([]);
});
