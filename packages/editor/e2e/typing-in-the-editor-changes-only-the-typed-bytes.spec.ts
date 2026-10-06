import { caret, expect, fixture, hostText, inSync, load, settled, test } from "./support.ts";

const blog = fixture("27-blog-post.md");
const paragraph = "That makes review painful.";
const paragraphEnd = "should be a one-word diff.";

test("typing at the end of a paragraph inserts only the typed text", async ({ harness: page }) => {
  await load(page, blog);
  await caret(page, paragraph, "End");
  await page.keyboard.type(" Really.");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(paragraphEnd, paragraphEnd + " Really."));
});

test("typing in a paragraph that holds a line break keeps the line break", async ({ harness: page }) => {
  await load(page, blog);
  await page.getByText("Most WYSIWYG").click({ position: { x: 1, y: 8 } });
  await inSync(page);
  await page.keyboard.type("Indeed, ");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace("Most WYSIWYG", "Indeed, Most WYSIWYG"));
});

test("pressing Enter and typing adds a paragraph and changes nothing else", async ({ harness: page }) => {
  await load(page, blog);
  await caret(page, paragraph, "End", "Enter");
  await page.keyboard.type("New paragraph.");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(paragraphEnd, paragraphEnd + "\n\nNew paragraph."));
});

test("undo restores the original bytes", async ({ harness: page }) => {
  await load(page, blog);
  await caret(page, paragraph, "End");
  await page.keyboard.type(" Really.");
  await settled(page);
  await page.keyboard.press("Control+z");
  await settled(page);
  expect(await hostText(page)).toBe(blog);
});

test("typing while the host is slow reaches the host complete", async ({ harness: page }) => {
  await load(page, blog);
  await page.evaluate(() => {
    window.harness.latency = 40;
  });
  await caret(page, paragraph, "End");
  await page.keyboard.type(" One two three.");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(paragraphEnd, paragraphEnd + " One two three."));
});
