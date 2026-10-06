import type { Page } from "@playwright/test";
import { caret, expect, fixture, hostText, load, settled, test } from "./support.ts";

const doc = fixture("36-images-and-relative-links.md");
const picture = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48"><rect width="120" height="48" rx="6" fill="#2f81f7"/></svg>`;

/**
 * Serves the harness's `/repo/` as a repository holding the fixture in `docs/`: every image there
 * is a picture except `settings.png`, which is not an image. Records each request for an image from
 * the web, and answers it with the picture.
 */
async function serve(page: Page): Promise<string[]> {
  const web: string[] = [];
  await page.route("**/repo/**", (route) =>
    route.request().url().endsWith("/settings.png")
      ? route.fulfill({ contentType: "image/png", body: "not an image" })
      : route.fulfill({ contentType: "image/svg+xml", body: picture }),
  );
  await page.route("https://example.com/**", (route) => {
    web.push(route.request().url());
    return route.fulfill({ contentType: "image/svg+xml", body: picture });
  });
  return web;
}

async function show(page: Page, remoteImages: boolean): Promise<void> {
  const origin = new URL(page.url()).origin;
  await page.evaluate(
    (r) => {
      window.harness.resources(r);
    },
    { base: `${origin}/repo/docs/`, root: `${origin}/repo/`, remoteImages },
  );
  await load(page, doc);
}

/** True once the image with alt text `alt` has loaded. */
async function loaded(page: Page, alt: string): Promise<boolean> {
  return page
    .getByRole("img", { name: alt, exact: true })
    .first()
    .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0);
}

async function opened(page: Page): Promise<string[]> {
  await settled(page);
  const messages = await page.evaluate(() => window.harness.messages);
  return messages.flatMap((m) => (m.type === "open" ? [m.href] : []));
}

test("images beside the file, from the root and from the web show, and one that does not load shows its alt text", async ({
  harness: page,
}) => {
  await serve(page);
  await show(page, true);
  for (const alt of ["Build pipeline", "Logo", "Coverage", "Home", "Small icon"]) {
    await expect.poll(() => loaded(page, alt)).toBe(true);
  }
  const missing = page.locator(".image[data-placeholder=missing]");
  await expect(missing).toHaveText(["Settings screen", "Settings"]);
  await expect(missing.first()).toHaveAttribute("title", "Image not found: images/settings.png");
  await page.screenshot({ path: "test-results/images.png", fullPage: true });
  expect(await hostText(page)).toBe(doc);
});

test("images from the web are placeholders while they are off, and are not requested", async ({ harness: page }) => {
  const web = await serve(page);
  await show(page, false);
  await expect.poll(() => loaded(page, "Build pipeline")).toBe(true);
  const placeholder = page.locator(".image[data-placeholder=remote]");
  await expect(placeholder).toHaveText("Coverage");
  await page.screenshot({ path: "test-results/images-from-the-web-off.png" });
  expect(web).toEqual([]);
  await show(page, true);
  await expect.poll(() => loaded(page, "Coverage")).toBe(true);
  expect(web).toEqual(["https://example.com/coverage.svg"]);
});

test("Ctrl+click on a link to a heading puts the cursor at the start of that heading", async ({ harness: page }) => {
  await load(page, doc);
  await page.locator("a", { hasText: "the second section of this name" }).click({ modifiers: ["Control"] });
  await page.keyboard.type("More ");
  await settled(page);
  const second = doc.lastIndexOf("## Further reading") + 3;
  expect(await hostText(page)).toBe(doc.slice(0, second) + "More " + doc.slice(second));
  await page.locator("a", { hasText: "the top" }).click({ modifiers: ["Control"] });
  await page.keyboard.type("On ");
  await settled(page);
  expect((await hostText(page)).startsWith("# On Images and relative links\n")).toBe(true);
});

test("Ctrl+click or Open on a link to a markdown file asks the host to open it", async ({ harness: page }) => {
  await load(page, doc);
  await page.locator("a", { hasText: "installation guide" }).click({ modifiers: ["Control"] });
  expect(await opened(page)).toEqual(["docs/install.md"]);
  await caret(page, "FAQ");
  const popover = page.getByRole("dialog", { name: "Link" });
  await popover.getByRole("button", { name: "Open" }).click();
  expect(await opened(page)).toEqual(["docs/install.md", "./FAQ.md#common-errors"]);
  expect(await hostText(page)).toBe(doc);
});

test("a plain click on a link places the cursor, and a link to the web has no Open button", async ({
  harness: page,
}) => {
  await load(page, fixture("35-inline-links.md"));
  await caret(page, "style guide");
  const popover = page.getByRole("dialog", { name: "Link" });
  await expect(popover.getByRole("button", { name: "Open" })).toBeVisible();
  await caret(page, "the docs");
  await expect(popover.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(popover.getByRole("button", { name: "Open" })).toBeHidden();
  expect(await opened(page)).toEqual([]);
});
