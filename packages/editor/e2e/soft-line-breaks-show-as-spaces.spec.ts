import type { Page } from "@playwright/test";
import { caretAt, expect, fixture, hostText, load, settled, test } from "./support.ts";

const blog = fixture("27-blog-post.md");
const firstLine = "Open a document,";
const wrapped = blog.slice(blog.indexOf("Most WYSIWYG"), blog.indexOf("\n\nThat makes"));

/** The height of the editor's paragraph that starts with `start`. */
async function paragraphHeight(page: Page, start: string): Promise<number> {
  return page.evaluate((s) => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((e) => e.textContent.startsWith(s))!;
    return p.getBoundingClientRect().height;
  }, start);
}

test("a wrapped paragraph flows as one block, as tall as its text on one line", async ({ harness: page }) => {
  const paragraph = page.locator(".ProseMirror p").first();
  await load(page, wrapped + "\n");
  const shown = { height: await paragraphHeight(page, "Most WYSIWYG"), text: await paragraph.innerText() };
  await load(page, wrapped.replace(/\n/g, " ") + "\n");
  const joined = { height: await paragraphHeight(page, "Most WYSIWYG"), text: await paragraph.innerText() };
  expect(shown).toEqual(joined);
});

test("hard line breaks still show as line breaks", async ({ harness: page }) => {
  await load(page, "One  \ntwo\\\nthree\n");
  const broken = await paragraphHeight(page, "One");
  await load(page, "One\n");
  const single = await paragraphHeight(page, "One");
  expect(broken).toBeCloseTo(single * 3, 0);
});

test("a code block keeps its lines", async ({ harness: page }) => {
  await load(page, "```\none\ntwo\n```\n");
  expect(await page.locator(".ProseMirror pre code").innerText()).toBe("one\ntwo");
});

test("one arrow key steps over a soft line break in each direction", async ({ harness: page }) => {
  await load(page, blog);
  await caretAt(page, firstLine, firstLine.length);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("A");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(firstLine + "\nfix", firstLine + "\nAfix"));
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("B");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(firstLine + "\nfix", firstLine + "B\nAfix"));
});

test("typing on either side of a soft line break stays on that side", async ({ harness: page }) => {
  await load(page, blog);
  await caretAt(page, firstLine, firstLine.length);
  await page.keyboard.type(" Then");
  await settled(page);
  await caretAt(page, "fix a typo", 0);
  await page.keyboard.type("Now ");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(firstLine + "\nfix", firstLine + " Then\nNow fix"));
});

test("Backspace after a soft line break and Delete before it join the lines", async ({ harness: page }) => {
  await load(page, blog);
  await caretAt(page, "fix a typo", 0);
  await page.keyboard.press("Backspace");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(firstLine + "\nfix", firstLine + "fix"));
  await load(page, blog);
  await caretAt(page, firstLine, firstLine.length);
  await page.keyboard.press("Delete");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(firstLine + "\nfix", firstLine + "fix"));
});

test("deleting or replacing the text beside a soft line break keeps the line break", async ({ harness: page }) => {
  await load(page, blog);
  await caretAt(page, firstLine, firstLine.length);
  await page.keyboard.press("Backspace");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(firstLine + "\nfix", "Open a document\nfix"));
  await caretAt(page, "fix a typo", 0);
  await page.keyboard.press("Delete");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(firstLine + "\nfix", "Open a document\nix"));
  await caretAt(page, "Open a document", "Open a ".length, "document".length);
  await page.keyboard.type("file");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(firstLine + "\nfix", "Open a file\nix"));
});

test("text inserted without a keypress or composed beside a soft line break keeps the line break", async ({
  harness: page,
}) => {
  await load(page, blog);
  await caretAt(page, "fix a typo", 0);
  await page.keyboard.insertText("é");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(firstLine + "\nfix", firstLine + "\néfix"));
  await load(page, blog);
  await caretAt(page, "fix a typo", 0);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "e", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.insertText", { text: "é" });
  await expect.poll(() => hostText(page)).toBe(blog.replace(firstLine + "\nfix", firstLine + "\néfix"));
});

test("Shift and an arrow key select a soft line break in one press", async ({ harness: page }) => {
  await load(page, blog);
  await caretAt(page, firstLine, firstLine.length);
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.type(" ");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(firstLine + "\nfix", firstLine + " fix"));
  await load(page, blog);
  await caretAt(page, "fix a typo", 0);
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.type(";");
  await settled(page);
  expect(await hostText(page)).toBe(blog.replace(firstLine + "\nfix", "Open a document;fix"));
});
