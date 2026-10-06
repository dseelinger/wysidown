import { expect, hostText, inSync, load, settled, test } from "./support.ts";

test("typing into an empty document puts only the typed text in the file", async ({ harness: page }) => {
  await load(page, "");
  await page.locator(".ProseMirror").click();
  await inSync(page);
  await page.keyboard.type("Hello");
  await settled(page);
  expect(await hostText(page)).toBe("Hello");
});

test("after selecting everything and deleting it, typing still works", async ({ harness: page }) => {
  await load(page, "# Title\n\nSome words.\n");
  await page.getByText("Some words.").click();
  await inSync(page);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await settled(page);
  expect(await hostText(page)).toBe("");
  await page.keyboard.type("New");
  await settled(page);
  expect(await hostText(page)).toBe("New\n");
});
