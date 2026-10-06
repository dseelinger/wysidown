import type { Frame } from "@playwright/test";
import { editorFrames, expect, fixture, readText, test } from "./support.ts";

const name = "36-images-and-relative-links.md";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48"><rect width="120" height="48" rx="6" fill="#2f81f7"/></svg>`;

/** The images the fixture names, except that `settings.png` is not an image, and a file it links to. */
const files = {
  "images/pipeline.png": png,
  "images/home.png": png,
  "images/settings.png": "not an image",
  "icons/ok.svg": svg,
  "icons/fail.svg": svg,
  "assets/logo.png": png,
  "docs/install.md": "# Installation\n\nRun the installer.\n",
};

/** True once the image with alt text `alt` has loaded. */
async function loaded(editor: Frame, alt: string): Promise<boolean> {
  return editor
    .getByRole("img", { name: alt, exact: true })
    .first()
    .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0);
}

test("images beside the file load, and images from the web are placeholders while they are turned off", async ({
  open,
}) => {
  const o = await open(name, { files, settings: { "wysidown.remoteImages": false } });
  for (const alt of ["Build pipeline", "Logo", "Home", "Small icon"]) {
    await expect.poll(() => loaded(o.editor, alt)).toBe(true);
  }
  await expect(o.editor.locator(".image[data-placeholder=missing]")).toHaveText(["Settings screen", "Settings"]);
  await expect(o.editor.locator(".image[data-placeholder=remote]")).toHaveText("Coverage");
  await o.window.screenshot({ path: "test-results/vscode-images.png" });
  expect(readText(o.path)).toBe(fixture(name));
});

test("Ctrl+click on a link to another markdown file opens it in Wysidown", async ({ open }) => {
  const o = await open(name, { files, settings: { "wysidown.remoteImages": false } });
  await o.editor.locator("a", { hasText: "installation guide" }).click({ modifiers: ["Control"] });
  const shows = async (text: string) => {
    for (const frame of await editorFrames(o.window)) if ((await frame.getByText(text).count()) > 0) return true;
    return false;
  };
  await expect.poll(() => shows("Run the installer."), { timeout: 15000 }).toBe(true);
  await expect(o.window.getByRole("tab", { name: /^install\.md/ })).toBeVisible();
});
