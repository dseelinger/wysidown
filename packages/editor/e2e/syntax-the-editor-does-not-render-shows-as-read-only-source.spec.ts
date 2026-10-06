import { caret, expect, fixture, hostText, load, settled, test } from "./support.ts";

test.describe("syntax the editor does not render shows as read-only source", () => {
  for (const name of ["11-html-blocks", "12-inline-html", "13-front-matter", "14-footnotes", "15-alerts", "16-math"]) {
    test(`${name} shows its unrendered syntax as chips`, async ({ harness: page }) => {
      await load(page, fixture(`${name}.md`));
      await expect(page.locator(".ProseMirror .raw").first()).toBeVisible();
      await page.locator(".ProseMirror").screenshot({ path: `test-results/chips-${name}.png` });
    });
  }

  test("each kind of raw block shows its label and its source, not editable", async ({ harness: page }) => {
    await load(
      page,
      fixture("13-front-matter.md") + "\n" + fixture("15-alerts.md") + "\n" + fixture("14-footnotes.md"),
    );
    const chip = (kind: string) => page.locator(`.ProseMirror pre.raw[data-kind="${kind}"]`);
    await expect(chip("yaml")).toHaveAttribute("data-label", "Front matter");
    await expect(chip("yaml")).toHaveText(/^---\ntitle: "Front matter test"/);
    await expect(chip("alert")).toHaveCount(5);
    await expect(chip("alert").first()).toHaveText("> [!NOTE]\n> Useful information that users should know.");
    await expect(chip("footnoteDefinition")).toHaveCount(2);
    await expect(page.locator(".ProseMirror blockquote")).toHaveCount(2);
    for (const raw of await page.locator(".ProseMirror .raw").all()) {
      await expect(raw).toHaveAttribute("contenteditable", "false");
    }
  });

  test("inline syntax shows its source in a chip, not editable", async ({ harness: page }) => {
    await load(page, fixture("16-math.md"));
    const inline = page.locator(".ProseMirror code.raw");
    await expect(inline.first()).toHaveText("$E = mc^2$");
    await expect(inline.first()).toHaveAttribute("contenteditable", "false");
  });

  test("typing beside an inline chip keeps the chip's source", async ({ harness: page }) => {
    const text = fixture("12-inline-html.md");
    await load(page, text);
    await caret(page, "to copy.", "End");
    await page.keyboard.type(" Or not.");
    await settled(page);
    expect(await hostText(page)).toBe(text.replace("to copy.", "to copy. Or not."));
  });

  test("Backspace after a definition that text refers to leaves the file unchanged", async ({ harness: page }) => {
    const text = "See [the docs][d].\n\n[d]: https://example.com\n\nAfter.\n";
    await load(page, text);
    await caret(page, "After.", "Home", "Backspace");
    await settled(page);
    expect(await hostText(page)).toBe(text);
    await expect(page.locator('.ProseMirror pre.raw[data-kind="definition"]')).toHaveCount(1);
  });

  test("Backspace after a definition nothing refers to deletes it", async ({ harness: page }) => {
    await load(page, "Text.\n\n[d]: https://example.com\n\nAfter.\n");
    await caret(page, "After.", "Home", "Backspace");
    await settled(page);
    expect(await hostText(page)).toBe("Text.\n\nAfter.\n");
  });
});
