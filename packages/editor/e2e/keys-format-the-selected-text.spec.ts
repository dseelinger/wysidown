import { caret, caretAt, expect, hostText, load, settled, test } from "./support.ts";

const doc = "Intro.\n\nSecond paragraph here.\n";

const marks: { key: string; shown: string; saved: string }[] = [
  { key: "Control+B", shown: "strong", saved: "**paragraph**" },
  { key: "Control+I", shown: "em", saved: "*paragraph*" },
  { key: "Control+Shift+X", shown: "del, s", saved: "~~paragraph~~" },
  { key: "Control+E", shown: "p code", saved: "`paragraph`" },
];

for (const mark of marks) {
  test(`${mark.key} formats the selected text`, async ({ harness: page }) => {
    await load(page, doc);
    await caretAt(page, "paragraph", 0, "paragraph".length);
    await page.keyboard.press(mark.key);
    await expect(page.locator(`.ProseMirror ${mark.shown}`)).toHaveText("paragraph");
    await settled(page);
    expect(await hostText(page)).toBe(doc.replace("paragraph", mark.saved));
  });
}

test("Ctrl+B with nothing selected makes the text typed next bold", async ({ harness: page }) => {
  await load(page, doc);
  await caret(page, "Intro.", "End");
  await page.keyboard.type(" ");
  await page.keyboard.press("Control+B");
  await page.keyboard.type("Bold");
  await page.keyboard.press("Control+B");
  await page.keyboard.type(" plain");
  await expect(page.locator(".ProseMirror strong")).toHaveText("Bold");
  await settled(page);
  expect(await hostText(page)).toBe(doc.replace("Intro.", "Intro. **Bold** plain"));
});

for (const level of [1, 2, 3, 4, 5, 6]) {
  test(`Ctrl+${String(level)} makes the block a level ${String(level)} heading, and again a paragraph`, async ({
    harness: page,
  }) => {
    await load(page, doc);
    await caret(page, "Second paragraph here.", "End");
    await page.keyboard.press(`Control+${String(level)}`);
    await expect(page.locator(`.ProseMirror h${String(level)}`)).toHaveText("Second paragraph here.");
    await settled(page);
    expect(await hostText(page)).toBe(doc.replace("Second", "#".repeat(level) + " Second"));
    await page.keyboard.press(`Control+${String(level)}`);
    await expect(page.locator(".ProseMirror p", { hasText: "Second" })).toHaveText("Second paragraph here.");
    await settled(page);
    expect(await hostText(page)).toBe(doc);
  });
}
