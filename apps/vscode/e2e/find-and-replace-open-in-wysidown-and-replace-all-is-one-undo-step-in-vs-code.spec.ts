import type { Frame } from "@playwright/test";
import { caret, expect, fixture, save, test, type Opened } from "./support.ts";

const name = "27-blog-post.md";
/** The image the fixture shows. */
const files = {
  "images/noisy-diff.png": Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
};
const heading = 'What "fidelity" means';
const blog = fixture(name);
const changed = blog
  .replace("the diff shows", "the change shows")
  .replace("one-word diff.", "one-word change.")
  .replace("best diff", "best change");

function bar(editor: Frame) {
  return editor.getByRole("dialog", { name: "Find and replace" });
}

async function openBlog(open: (name: string, options: { files: typeof files }) => Promise<Opened>): Promise<Opened> {
  const o = await open(name, { files });
  await caret(o, heading);
  return o;
}

test("Ctrl+F and Ctrl+H open Wysidown's find bar, not VS Code's find widget", async ({ open }) => {
  const o = await openBlog(open);
  await o.window.keyboard.press("Control+F");
  await expect(bar(o.editor).getByRole("textbox", { name: "Find" })).toBeFocused();
  await o.window.keyboard.type("diff");
  await expect(bar(o.editor)).toContainText("of 3");
  await o.window.keyboard.press("Alt+R");
  await o.window.keyboard.press("Alt+W");
  await o.window.keyboard.press("Alt+C");
  for (const option of ["Use Regular Expression", "Match Whole Word", "Match Case"]) {
    await expect(bar(o.editor).getByRole("button", { name: option })).toHaveAttribute("aria-pressed", "true");
  }
  await o.window.keyboard.press("Escape");
  await expect(bar(o.editor)).toBeHidden();
  await o.window.keyboard.press("Control+H");
  await expect(bar(o.editor).getByRole("textbox", { name: "Replace" })).toBeVisible();
  await o.window.screenshot({ path: "test-results/find-bar-in-vs-code.png" });
  await expect(o.window.locator(".find-widget.visible")).toHaveCount(0);
  await expect(o.window.locator(".monaco-menu-container")).toHaveCount(0);
});

test("a Replace All is undone by one Ctrl+Z", async ({ open }) => {
  const o = await openBlog(open);
  await o.window.keyboard.press("Control+H");
  await o.window.keyboard.type("diff");
  await expect(bar(o.editor)).toContainText("of 3");
  await bar(o.editor).getByRole("textbox", { name: "Replace" }).fill("change");
  await o.window.keyboard.press("Control+Alt+Enter");
  await save(o, changed);
  await o.window.keyboard.press("Escape");
  await expect(bar(o.editor)).toBeHidden();
  await o.window.keyboard.press("Control+Z");
  await save(o, blog);
});
