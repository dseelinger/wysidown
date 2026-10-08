import { caret, caretAt, expect, hostText, load, settled, test } from "./support.ts";

const doc = "Intro.\n\nSecond paragraph.\n\n```\ncode\n```\n";

/** `undone` is where Backspace leaves the typed syntax, and what that block then shows. */
const blocks: { typed: string; shown: string; saved: string; undone: [string, string] }[] = [
  { typed: "## ", shown: "h2", saved: "## Second paragraph.", undone: ["> p", "## "] },
  { typed: "* ", shown: "ul > li", saved: "- Second paragraph.", undone: ["> p", "* "] },
  { typed: "3) ", shown: "ol > li", saved: "3. Second paragraph.", undone: ["> p", "3) "] },
  { typed: "- [ ] ", shown: "li.task", saved: "- [ ] Second paragraph.", undone: ["li:not(.task)", "[ ] "] },
  { typed: "> ", shown: "blockquote > p", saved: "> Second paragraph.", undone: ["> p", "> "] },
];

for (const block of blocks) {
  test(`${JSON.stringify(block.typed)} typed at the start of a paragraph formats it, and Backspace takes it back`, async ({
    harness: page,
  }) => {
    await load(page, doc);
    await caretAt(page, "Second paragraph.", 0);
    await page.keyboard.type(block.typed);
    await expect(page.locator(`.ProseMirror ${block.shown}`)).toHaveText("Second paragraph.");
    await settled(page);
    expect(await hostText(page)).toBe(doc.replace("Second paragraph.", block.saved));
    await page.keyboard.press("Backspace");
    const [place, kept] = block.undone;
    await expect(page.locator(`.ProseMirror ${place}`, { hasText: "Second" })).toHaveText(kept + "Second paragraph.");
  });
}

const marks: { typed: string; shown: string; saved: string }[] = [
  { typed: "**bold**", shown: "strong", saved: "**bold**" },
  { typed: "_italic_", shown: "em", saved: "*italic*" },
  { typed: "`code`", shown: "p code", saved: "`code`" },
  { typed: "~~struck~~", shown: "del, s", saved: "~~struck~~" },
];

for (const mark of marks) {
  test(`${JSON.stringify(mark.typed)} typed after text formats it once the closing marker is typed`, async ({
    harness: page,
  }) => {
    await load(page, doc);
    await caret(page, "Second paragraph.", "End");
    await page.keyboard.type(" " + mark.typed + " after");
    const word = mark.typed.replace(/[*_`~]/g, "");
    await expect(page.locator(`.ProseMirror ${mark.shown}`)).toHaveText(word);
    await settled(page);
    expect(await hostText(page)).toBe(doc.replace("paragraph.", `paragraph. ${mark.saved} after`));
  });
}

test("a fence with a language and Enter starts a code block, and a rule and Enter adds a rule", async ({
  harness: page,
}) => {
  await load(page, doc);
  await caret(page, "Intro.", "End", "Enter");
  await page.keyboard.type("```js");
  await page.keyboard.press("Enter");
  await page.keyboard.type("let x = 1;");
  await expect(page.locator(".ProseMirror pre").first()).toHaveText("let x = 1;");
  await caret(page, "Second paragraph.", "End", "Enter");
  await page.keyboard.type("---");
  await page.keyboard.press("Enter");
  await page.keyboard.type("After the rule.");
  await expect(page.locator(".ProseMirror hr")).toHaveCount(1);
  await settled(page);
  expect(await hostText(page)).toBe(
    "Intro.\n\n```js\nlet x = 1;\n```\n\nSecond paragraph.\n\n---\n\nAfter the rule.\n\n```\ncode\n```\n",
  );
  await page.locator(".ProseMirror").screenshot({ path: "test-results/typed-syntax.png" });
});

test("Backspace straight after a rule made with Enter leaves the typed dashes", async ({ harness: page }) => {
  await load(page, doc);
  await caret(page, "Intro.", "End", "Enter");
  await page.keyboard.type("---");
  await page.keyboard.press("Enter");
  await expect(page.locator(".ProseMirror hr")).toHaveCount(1);
  await page.keyboard.press("Backspace");
  await expect(page.locator(".ProseMirror hr")).toHaveCount(0);
  await expect(page.locator(".ProseMirror > p").nth(1)).toHaveText("---");
});

test("syntax typed in a code block stays as typed", async ({ harness: page }) => {
  await load(page, doc);
  await caret(page, "code", "End");
  await page.keyboard.type(" **x** `y`");
  await caretAt(page, "code", 0);
  await page.keyboard.type("# ");
  await settled(page);
  expect(await hostText(page)).toBe(doc.replace("code\n", "# code **x** `y`\n"));
});
