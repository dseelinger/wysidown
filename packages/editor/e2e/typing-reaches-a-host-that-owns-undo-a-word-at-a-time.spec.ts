import type { EditorMessage } from "@wysidown/core";
import type { Page } from "@playwright/test";
import { caret, expect, fixture, hostText, load, settled, test } from "./support.ts";

const blog = fixture("27-blog-post.md");
const paragraph = "That makes review painful.";
const paragraphEnd = "should be a one-word diff.";
const typed = blog.replace(paragraphEnd, paragraphEnd + " Really");

/** The text each edit the editor sent inserts, in order. */
async function insertedByEdits(page: Page): Promise<string[]> {
  const messages = await page.evaluate(() => window.harness.messages);
  return messages
    .filter((m): m is Extract<EditorMessage, { type: "edit" }> => m.type === "edit")
    .map((m) => m.edits.map((e) => e.insert).join(""));
}

test.beforeEach(async ({ harness: page }) => {
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
});

test("held typing reaches the host as one edit after a pause", async ({ harness: page }) => {
  await page.keyboard.type(" Really");
  await settled(page);
  expect(await hostText(page)).toBe(blog);
  await expect.poll(() => hostText(page)).toBe(typed);
  expect(await insertedByEdits(page)).toEqual([" Really"]);
});

test("held typing reaches the host when the host asks for it", async ({ harness: page }) => {
  await page.keyboard.type(" Really");
  expect(await page.evaluate(() => window.harness.flush())).toBe(typed);
});

test("a key combination sends held typing before the host sees the key", async ({ harness: page }) => {
  await page.keyboard.type(" Really");
  await page.keyboard.press("Control+s");
  await settled(page);
  expect(await hostText(page)).toBe(typed);
});

/** The keys the host's window listener saw with Ctrl held. */
async function keysSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { keysSeen: string[] }).keysSeen);
}

test("Ctrl+Z while typing is held removes the held word, and the host's key listener does not see it", async ({
  harness: page,
}) => {
  await page.keyboard.type(" Really sure");
  await page.keyboard.press("Control+z");
  await settled(page);
  expect(await keysSeen(page)).toEqual([]);
  expect(await hostText(page)).toBe(typed);
  await expect(page.locator("p", { hasText: paragraph })).toHaveText(
    paragraph + " A one-word change " + paragraphEnd + " Really",
  );
  await page.keyboard.press("Control+z");
  expect(await keysSeen(page)).toEqual(["z"]);
});

test("Ctrl+Y while typing is held sends the typing, and the host's key listener does not see it", async ({
  harness: page,
}) => {
  await page.keyboard.type(" Really");
  await page.keyboard.press("Control+y");
  await settled(page);
  expect(await keysSeen(page)).toEqual([]);
  expect(await hostText(page)).toBe(typed);
});
