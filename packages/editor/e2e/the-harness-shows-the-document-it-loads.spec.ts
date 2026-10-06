import { expect, fixture, load, test } from "./support.ts";

test("the harness shows a loaded document as formatted text", async ({ harness: page }) => {
  await load(page, fixture("27-blog-post.md"));
  const editor = page.locator(".ProseMirror");
  await expect(editor.locator("h2")).toHaveText('What "fidelity" means');
  await expect(editor.locator("ol > li")).toHaveCount(3);
  await expect(editor.locator("blockquote")).toContainText("The best diff is the one you expected.");
  await expect(editor.locator("em").first()).toHaveText("every");
  await expect(editor).toHaveAttribute("contenteditable", "true");
});
