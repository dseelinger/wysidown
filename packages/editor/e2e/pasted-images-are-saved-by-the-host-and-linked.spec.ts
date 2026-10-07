import type { Page } from "@playwright/test";
import { caret, expect, hostText, load, settled, test } from "./support.ts";

/** A 1×1 PNG image, in base64. */
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Pastes clipboard `data`, keyed by type, and the images in `files` (base64 PNG bytes), at the caret. */
async function paste(page: Page, data: Record<string, string>, files: string[] = []): Promise<void> {
  await page.evaluate(
    ({ items, images }) => {
      const transfer = new DataTransfer();
      for (const [type, value] of Object.entries(items)) transfer.setData(type, value);
      for (const image of images) {
        const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
        transfer.items.add(new File([bytes], "image.png", { type: "image/png" }));
      }
      const target = document.activeElement ?? document.querySelector(".ProseMirror")!;
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    },
    { items: data, images: files },
  );
}

/** Waits until the host has answered for `count` images in all, and every message has arrived. */
async function answered(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => window.harness.messages.filter((m) => m.type === "imageSaved").length >= n, count);
  await settled(page);
}

async function images(page: Page): Promise<{ path: string; data: string }[]> {
  return page.evaluate(() => window.harness.images());
}

const notes = "# Notes\n\nIntro.\n\nLast.\n";

test("a pasted screenshot is saved by the host and linked where it was pasted", async ({ harness: page }) => {
  await load(page, notes);
  await caret(page, "Intro.", "End");
  await paste(page, {}, [png]);
  await answered(page, 1);
  expect(await hostText(page)).toBe("# Notes\n\nIntro.![](images/image-1.png)\n\nLast.\n");
  await paste(page, {}, [png]);
  await answered(page, 2);
  expect(await hostText(page)).toBe("# Notes\n\nIntro.![](images/image-1.png)![](images/image-2.png)\n\nLast.\n");
  expect(await images(page)).toEqual([
    { path: "images/image-1.png", data: png },
    { path: "images/image-2.png", data: png },
  ]);
});

test("an image in pasted HTML that is only on the clipboard is saved, with the text around it", async ({
  harness: page,
}) => {
  await load(page, notes);
  await caret(page, "Intro.", "End");
  await paste(page, {
    "text/html": `<p>Before <img src="data:image/png;base64,${png}" alt="chart"> and <img src="https://example.com/x.png" alt="web"></p>`,
    "text/plain": "Before  and ",
  });
  await answered(page, 1);
  expect(await hostText(page)).toBe(
    "# Notes\n\nIntro.Before ![chart](images/image-1.png) and ![web](https://example.com/x.png)\n\nLast.\n",
  );
  expect(await images(page)).toEqual([{ path: "images/image-1.png", data: png }]);
});

test("a picture copied in Word is saved from the clipboard's image", async ({ harness: page }) => {
  await load(page, notes);
  await caret(page, "Intro.", "End");
  await paste(
    page,
    {
      "text/html":
        '<html><body><!--StartFragment--><p class=MsoNormal><img width=1 height=1 src="file:///C:/Users/me/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png"><o:p></o:p></p><!--EndFragment--></body></html>',
    },
    [png],
  );
  await answered(page, 1);
  expect(await hostText(page)).toBe("# Notes\n\nIntro.![](images/image-1.png)\n\nLast.\n");
});

test("text copied in Word with its picture on the clipboard pastes as text alone", async ({ harness: page }) => {
  await load(page, notes);
  await caret(page, "Intro.", "End");
  await paste(page, { "text/html": "<p class=MsoNormal>Words<o:p></o:p></p>", "text/plain": "Words" }, [png]);
  await settled(page);
  expect(await hostText(page)).toBe("# Notes\n\nIntro.Words\n\nLast.\n");
  expect(await images(page)).toEqual([]);
});

test("an image the host does not save is left out, and the rest is pasted", async ({ harness: page }) => {
  await load(page, notes);
  await page.evaluate(() => {
    window.harness.hasFolder(false);
  });
  await caret(page, "Intro.", "End");
  await paste(page, {}, [png]);
  await answered(page, 1);
  expect(await hostText(page)).toBe(notes);
  await paste(page, { "text/html": `<p>Kept <img src="data:image/png;base64,${png}"> text</p>` });
  await answered(page, 2);
  expect(await hostText(page)).toBe("# Notes\n\nIntro.Kept  text\n\nLast.\n");
  expect(await images(page)).toEqual([]);
});

test("typing while an image is saved does not move the paste", async ({ harness: page }) => {
  await load(page, notes);
  await page.evaluate(() => {
    window.harness.latency = 300;
  });
  await caret(page, "Intro.", "End");
  await paste(page, {}, [png]);
  await page.keyboard.type("x");
  await caret(page, "Last.", "Home");
  await page.keyboard.type("At ");
  await answered(page, 1);
  expect(await hostText(page)).toBe("# Notes\n\nIntro.x![](images/image-1.png)\n\nAt Last.\n");
});
