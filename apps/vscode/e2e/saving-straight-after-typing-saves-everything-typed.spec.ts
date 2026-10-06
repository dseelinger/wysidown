import { caret, expect, fixture, readText, test } from "./support.ts";

const nested = fixture("04-lists-nested.md");

test("Ctrl+S pressed straight after typing saves every typed character", async ({ open }) => {
  const o = await open("04-lists-nested.md");
  await caret(o, "Pears", "End");
  await o.window.keyboard.type(" and figs");
  await o.window.keyboard.press("Control+S");
  await expect.poll(() => readText(o.path), { timeout: 10000 }).not.toBe(nested);
  await o.window.waitForTimeout(1000);
  expect(readText(o.path)).toBe(nested.replace("  - Pears\n", "  - Pears and figs\n"));
  await expect.poll(() => o.window.title()).not.toContain("●");
});
