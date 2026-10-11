import { expect, load, test } from "./support.ts";

test("code blocks and inline code are not spellchecked, and paragraphs are", async ({ harness: page }) => {
  await load(page, "A paragraph with `inlinecode` in it.\n\n```\nblokcode\n```\n");
  const checked = await page.evaluate(() => ({
    block: document.querySelector<HTMLElement>(".ProseMirror pre code")!.spellcheck,
    inline: document.querySelector<HTMLElement>(".ProseMirror p code")!.spellcheck,
    paragraph: document.querySelector<HTMLElement>(".ProseMirror p")!.spellcheck,
  }));
  expect(checked).toEqual({ block: false, inline: false, paragraph: true });
});
