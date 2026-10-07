import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { caret, expect, fixture, save, test } from "./support.ts";

const name = "20-headings.md";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("a pasted screenshot is saved in images beside the file and linked where it was pasted", async ({ open }) => {
  const o = await open(name);
  await caret(o, "Five", "End");
  await o.editor.evaluate((image) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
    transfer.items.add(new File([bytes], "image.png", { type: "image/png" }));
    const target = document.activeElement ?? document.querySelector(".ProseMirror")!;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, png);
  const saved = join(dirname(o.path), "images", "image-1.png");
  await expect.poll(() => existsSync(saved), { timeout: 10000 }).toBe(true);
  expect(readFileSync(saved).toString("base64")).toBe(png);
  await expect(o.editor.locator(".image img")).toHaveCount(1);
  await save(o, fixture(name).replace("##### Five\n", "##### Five![](images/image-1.png)\n"));
});
