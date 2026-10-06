import { caret, expect, fixture, hostText, load, settled, test } from "./support.ts";

const blog = fixture("27-blog-post.md");

test("an external change shows the new text and keeps the cursor in an unchanged block", async ({ harness: page }) => {
  await load(page, blog);
  await caret(page, "Thanks for reading.", "Home");

  const changed = blog.replace("That makes review painful.", "That makes every review painful.");
  await page.evaluate((t) => {
    window.harness.change(t);
  }, changed);
  await settled(page);
  await expect(page.locator(".ProseMirror > p").nth(1)).toHaveText(
    "That makes every review painful. A one-word change should be a one-word diff.",
  );

  await page.keyboard.type("Again: ");
  await settled(page);
  expect(await hostText(page)).toBe(changed.replace("Thanks for reading.", "Again: Thanks for reading."));
});
