import { caret, editorFrames, expect, fixture, save, shownAgain, test, type Opened } from "./support.ts";

const nested = fixture("04-lists-nested.md");
const typed = nested.replace("  - Pears\n", "  - Pears and figs\n");

/** Runs a command from the command palette by its label. */
async function command(o: Opened, label: string): Promise<void> {
  await o.window.keyboard.press("Control+Shift+P");
  const input = o.window.locator(".quick-input-widget input");
  await input.fill(">" + label);
  await o.window.locator(".quick-input-list .monaco-list-row", { hasText: label }).first().click();
}

test("typing then switching to another editor at once keeps every typed character", async ({ open }) => {
  const o = await open("04-lists-nested.md");
  await command(o, "File: New Untitled Text File");
  await o.window.keyboard.press("Control+PageUp");
  await shownAgain(o);
  await caret(o, "Pears", "End");
  await o.window.keyboard.type(" and figs");
  await o.window.keyboard.press("Control+PageDown");
  await expect.poll(() => o.editor.isDetached()).toBe(true);
  await o.window.keyboard.press("Control+PageUp");
  await shownAgain(o);
  await save(o, typed);
});

test("typing then closing one of two editors of the file at once keeps every typed character", async ({ open }) => {
  const o = await open("04-lists-nested.md");
  await command(o, "View: Split Editor Right");
  await expect.poll(() => editorFrames(o.window).then((f) => f.length)).toBe(2);
  await caret(o, "Pears", "End");
  await o.window.keyboard.type(" and figs");
  await o.window.keyboard.press("Control+W");
  await expect.poll(() => editorFrames(o.window).then((f) => f.length)).toBe(1);
  await save(o, typed);
});
