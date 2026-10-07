import { test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  answerMessageBoxes,
  clickAtEnd,
  copyFixture,
  expect,
  fixture,
  launch,
  messageBoxes,
  quit,
  save,
} from "./support.ts";

const name = "20-headings.md";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Pastes a clipboard holding only the PNG image `image` (base64) at the caret. */
async function pasteImage(window: Page, image: string): Promise<void> {
  await window.evaluate((data) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    transfer.items.add(new File([bytes], "image.png", { type: "image/png" }));
    const target = document.activeElement ?? document.querySelector(".ProseMirror")!;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, image);
}

test("a pasted screenshot is saved in images beside the file, shown, and linked where it was pasted", async () => {
  const path = copyFixture(name);
  const { app, window, errors } = await launch(path);
  try {
    await clickAtEnd(window, "Five");
    await pasteImage(window, png);
    await expect(window.locator(".ProseMirror .image img")).toHaveCount(1);
    await expect
      .poll(() => window.locator(".ProseMirror .image img").evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(1);
    await pasteImage(window, png);
    await expect(window.locator(".ProseMirror .image img")).toHaveCount(2);
    for (const file of ["image-1.png", "image-2.png"]) {
      expect(readFileSync(join(dirname(path), "images", file)).toString("base64")).toBe(png);
    }
    await save(
      app,
      path,
      fixture(name).replace("##### Five\n", "##### Five![](images/image-1.png)![](images/image-2.png)\n"),
    );
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("an image pasted into a document never saved is refused with a message", async () => {
  const { app, window, errors } = await launch();
  try {
    await answerMessageBoxes(app, "OK");
    await window.locator(".ProseMirror").click();
    await pasteImage(window, png);
    await expect.poll(() => messageBoxes(app)).toEqual(["Wysidown cannot paste the image."]);
    await expect(window.locator(".ProseMirror .image")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("the app writes nothing for a request whose bytes are not an image, whatever the page asks", async () => {
  const path = copyFixture(name);
  const { app, window, errors } = await launch(path);
  try {
    await answerMessageBoxes(app, "OK");
    await window.evaluate(() => {
      const bridge = (globalThis as unknown as { wysidown: { post(message: unknown): void } }).wysidown;
      bridge.post({ type: "saveImage", id: 1, data: btoa("<svg xmlns='http://www.w3.org/2000/svg'/>") });
      bridge.post({ type: "saveImage", id: 2, data: "../../evil" });
    });
    await expect.poll(() => messageBoxes(app)).toEqual(["Wysidown cannot paste the image."]);
    expect(existsSync(join(dirname(path), "images"))).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});
