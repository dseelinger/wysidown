import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  expect,
  fixture,
  launch,
  menu,
  newFolder,
  quit,
  readText,
  title,
  userDataArgument,
  type Launched,
} from "./support.ts";

const name = "36-images-and-relative-links.md";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48"><rect width="120" height="48" rx="6" fill="#2f81f7"/></svg>`;

/**
 * A new repository folder holding the fixture in `guide/`, the images it names except that
 * `settings.png` is not an image, the files it links to, and a picture outside the repository.
 * Returns the fixture's path.
 */
function repository(): string {
  const outside = newFolder();
  const root = join(outside, "repo");
  const files: Record<string, string | Buffer> = {
    [`guide/${name}`]: fixture(name),
    "guide/images/pipeline.png": png,
    "guide/images/home.png": png,
    "guide/images/settings.png": "not an image",
    "guide/icons/ok.svg": svg,
    "guide/icons/fail.svg": svg,
    "guide/docs/install.md": "# Installation\n\nRun the installer.\n",
    "guide/docs/release plan.md": "# Release plan\n\nShip on Friday.\n",
    "assets/logo.png": png,
    "CHANGELOG.md": "# Changelog\n\nThe first release.\n",
  };
  mkdirSync(join(root, ".git"), { recursive: true });
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  writeFileSync(join(outside, "outside.png"), png);
  return join(root, "guide", name);
}

/** Settings that keep images from the web off, so that no test reaches the network. */
function offline(): string {
  const folder = newFolder();
  writeFileSync(join(folder, "settings.json"), JSON.stringify({ remoteImages: false }));
  return userDataArgument(folder);
}

/** True once the image with alt text `alt` has loaded. */
async function loaded({ window }: Launched, alt: string): Promise<boolean> {
  return window
    .getByRole("img", { name: alt, exact: true })
    .first()
    .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0);
}

test("images beside the file and from the repository root load, and other files are not served", async () => {
  const path = repository();
  const launched = await launch(offline(), path);
  const { app, window, errors } = launched;
  try {
    for (const alt of ["Build pipeline", "Logo", "Home", "Small icon"]) {
      await expect.poll(() => loaded(launched, alt)).toBe(true);
    }
    await expect(window.locator(".image[data-placeholder=missing]")).toHaveText(["Settings screen", "Settings"]);
    await expect(window.locator(".image[data-placeholder=remote]")).toHaveText("Coverage");
    const base = await window.locator("img[alt='Logo']").evaluate((image: HTMLImageElement) => image.src);
    const loads = (url: string) =>
      window.evaluate(
        (src) =>
          new Promise<boolean>((resolve) => {
            const image = new Image();
            image.onload = () => {
              resolve(true);
            };
            image.onerror = () => {
              resolve(false);
            };
            image.src = src;
          }),
        url,
      );
    expect(await loads(new URL("../../outside.png", base).href)).toBe(false);
    expect(await loads(new URL("../guide/docs/install.md", base).href)).toBe(false);
    expect(errors).toEqual([]);
    expect(readText(path)).toBe(fixture(name));
  } finally {
    await quit(app);
  }
});

test("Ctrl+click on a link to another markdown file opens it in the window", async () => {
  const path = repository();
  const { app, window, errors } = await launch(offline(), path);
  try {
    await window.locator("a", { hasText: "installation guide" }).click({ modifiers: ["Control"] });
    await expect(window.getByText("Run the installer.")).toBeVisible();
    expect(await title(app)).toBe("install.md — Wysidown");
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("links from the repository root and with escaped spaces open their files", async () => {
  for (const [link, text, file] of [
    ["changelog", "The first release.", "CHANGELOG.md"],
    ["one that is escaped", "Ship on Friday.", "release plan.md"],
  ] as const) {
    const { app, window, errors } = await launch(offline(), repository());
    try {
      await window.locator("a", { hasText: link }).click({ modifiers: ["Control"] });
      await expect(window.getByText(text)).toBeVisible();
      expect(await title(app)).toBe(`${file} — Wysidown`);
      expect(errors).toEqual([]);
    } finally {
      await quit(app);
    }
  }
});

test("turning off View > Load Images from the Web shows them as placeholders, and is remembered", async () => {
  const userData = newFolder();
  const path = repository();
  let launched = await launch(userDataArgument(userData), path);
  try {
    await launched.window.route("https://example.com/**", (route) =>
      route.fulfill({ contentType: "image/svg+xml", body: svg }),
    );
    await launched.window.reload();
    await expect.poll(() => loaded(launched, "Coverage")).toBe(true);
    await menu(launched.app, "remote-images");
    await expect(launched.window.locator(".image[data-placeholder=remote]")).toHaveText("Coverage");
    await expect.poll(() => readText(join(userData, "settings.json"))).toContain('"remoteImages": false');
    expect(launched.errors).toEqual([]);
  } finally {
    await quit(launched.app);
  }
  launched = await launch(userDataArgument(userData), path);
  try {
    await expect(launched.window.locator(".image[data-placeholder=remote]")).toHaveText("Coverage");
    const checked = await launched.app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("remote-images")!.checked,
    );
    expect(checked).toBe(false);
    expect(launched.errors).toEqual([]);
  } finally {
    await quit(launched.app);
  }
});
