import { caret, expect, fixture, hostText, load, settled, test } from "./support.ts";

const blog = fixture("27-blog-post.md");
const paragraph = "That makes review painful.";
const paragraphEnd = "should be a one-word diff.";

for (const key of ["Control+z", "Control+y", "Control+Shift+z"]) {
  test(`${key} reaches the page and leaves the document unchanged`, async ({ harness: page }) => {
    await page.goto("/?undo=host");
    await page.waitForFunction(() => "harness" in window);
    // A VS Code webview passes undo keys to VS Code from a listener on the window.
    await page.evaluate(() => {
      const seen: string[] = [];
      Object.assign(window, { keysSeen: seen });
      window.addEventListener("keydown", (event) => {
        if (event.ctrlKey && event.key.length === 1) seen.push(event.key.toLowerCase());
      });
    });
    await load(page, blog);
    await caret(page, paragraph, "End");
    await page.keyboard.type(" Really.");
    // Typing reaches the host after a pause; until then the editor handles undo and redo itself.
    await expect.poll(() => hostText(page)).toBe(blog.replace(paragraphEnd, paragraphEnd + " Really."));
    await page.keyboard.press(key);
    await settled(page);
    expect(await page.evaluate(() => (window as unknown as { keysSeen: string[] }).keysSeen)).toEqual([key.slice(-1)]);
    expect(await hostText(page)).toBe(blog.replace(paragraphEnd, paragraphEnd + " Really."));
  });
}
