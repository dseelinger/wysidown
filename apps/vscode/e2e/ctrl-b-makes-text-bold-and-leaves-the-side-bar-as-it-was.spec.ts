import { caret, expect, fixture, save, test } from "./support.ts";

const nested = fixture("04-lists-nested.md");

test("Ctrl+B makes the selected word bold and leaves the side bar open or closed as it was", async ({ open }) => {
  const o = await open("04-lists-nested.md");
  // VS Code hides the side bar by giving it no width.
  const sideBarShown = () =>
    o.window.evaluate(() => document.getElementById("workbench.parts.sidebar")!.offsetWidth > 0);
  const shown = await sideBarShown();
  await caret(o, "Pears", "End", "Control+Shift+ArrowLeft", "Control+B");
  await expect(o.editor.locator(".ProseMirror strong")).toHaveText("Pears");
  await save(o, nested.replace("  - Pears\n", "  - **Pears**\n"));
  expect(await sideBarShown()).toBe(shown);
});
