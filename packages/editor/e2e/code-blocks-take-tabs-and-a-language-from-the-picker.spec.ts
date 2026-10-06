import { caret, expect, fixture, hostText, inSync, load, settled, test } from "./support.ts";

const fenced = fixture("07-code-fenced.md");

test("a code block shows its language in a picker above its text, tabs and all", async ({ harness: page }) => {
  await load(page, fenced + "\n```go\nfunc main() {\n\tprintln()\n}\n```\n");
  const pickers = page.getByRole("combobox", { name: "Code language" });
  await expect(pickers).toHaveCount(7);
  await expect(pickers.nth(0)).toHaveValue("ts");
  await expect(pickers.nth(1)).toHaveValue("python");
  await expect(pickers.nth(3)).toHaveValue("");
  const tab = await page
    .locator(".code-block pre")
    .last()
    .evaluate((pre) => getComputedStyle(pre).tabSize);
  expect(tab).toBe("4");
  await page.locator(".ProseMirror").screenshot({ path: "test-results/code-blocks.png" });
});

test("Tab in a code block types a tab instead of leaving the editor", async ({ harness: page }) => {
  const text = "Text.\n\n```make\necho done\n```\n";
  await load(page, text);
  await caret(page, "echo done", "Home", "Tab");
  await page.keyboard.type("x");
  await settled(page);
  expect(await hostText(page)).toBe(text.replace("echo done", "\txecho done"));
});

test("a language typed into the picker is saved in the info string alone", async ({ harness: page }) => {
  await load(page, fenced);
  const picker = page.getByRole("combobox", { name: "Code language" }).nth(1);
  await picker.click();
  await picker.fill("py");
  await page.keyboard.press("Enter");
  await settled(page);
  expect(await hostText(page)).toBe(fenced.replace('~~~python title="example.py"', '~~~py title="example.py"'));
  await inSync(page);
  await page.keyboard.type("# ");
  await settled(page);
  expect(await hostText(page)).toBe(
    fenced.replace('~~~python title="example.py"\ndef', '~~~py title="example.py"\n# def'),
  );
  await page.locator(".code-block").nth(1).screenshot({ path: "test-results/code-language.png" });
});

test("Escape in the picker puts the language back without saving", async ({ harness: page }) => {
  await load(page, fenced);
  const picker = page.getByRole("combobox", { name: "Code language" }).first();
  await picker.click();
  await picker.fill("rust");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveValue("ts");
  await settled(page);
  expect(await hostText(page)).toBe(fenced);
});
