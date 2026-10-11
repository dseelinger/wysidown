import { test, type ElectronApplication } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { chooseToSaveAs, copyFixture, expect, launch, newFolder, newPath, quit, userDataArgument } from "./support.ts";

/** The titles of the app's windows, sorted. */
async function titles(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .map((w) => w.getTitle())
      .sort(),
  );
}

/** Launches the app a second time with `args`, as a user would from a shortcut, and waits for it to exit. */
async function launchAgain(app: ElectronApplication, ...args: string[]): Promise<void> {
  const electron = await app.evaluate(() => process.execPath);
  const main = join(import.meta.dirname, "..", "dist", "main.cjs");
  const second = spawnSync(electron, [main, ...args], { timeout: 30_000 });
  expect(second.status).toBe(0);
}

test("a second launch opens its file in a new window of the running app and exits", async () => {
  const userData = userDataArgument(newFolder());
  const { app, window, errors } = await launch(userData);
  try {
    await expect(window.locator(".ProseMirror")).toBeVisible();
    const path = copyFixture("25-changelog.md");
    const electron = await app.evaluate(() => process.execPath);
    const main = join(import.meta.dirname, "..", "dist", "main.cjs");
    // A relative path, so the file is found from the second launch's working folder.
    const second = spawnSync(electron, [main, userData, basename(path)], { cwd: dirname(path), timeout: 30_000 });
    expect(second.status).toBe(0);

    await expect.poll(() => app.windows().length).toBe(2);
    await expect.poll(() => titles(app)).toEqual(["25-changelog.md — Wysidown", "Untitled.md — Wysidown"]);
    const opened = app.windows().find((page) => page !== window);
    await expect(opened!.locator(".ProseMirror h1")).toHaveText("Changelog");
    await expect(window.locator(".ProseMirror h1")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("each untitled window takes the lowest Untitled number not in use", async () => {
  const userData = userDataArgument(newFolder());
  const { app, window, errors } = await launch(userData);
  try {
    await expect(window.locator(".ProseMirror")).toBeVisible();
    await launchAgain(app, userData);
    await expect.poll(() => titles(app)).toEqual(["Untitled-2.md — Wysidown", "Untitled.md — Wysidown"]);

    const path = newPath("saved.md");
    await chooseToSaveAs(app, path);
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const first = BrowserWindow.getAllWindows().find((w) => w.getTitle() === "Untitled.md — Wysidown");
      const item = Menu.getApplicationMenu()!.getMenuItemById("save")!;
      (item.click as (event: unknown, window: unknown) => void)({}, first);
    });
    await expect.poll(() => titles(app)).toEqual(["Untitled-2.md — Wysidown", "saved.md — Wysidown"]);

    await launchAgain(app, userData);
    await expect
      .poll(() => titles(app))
      .toEqual(["Untitled-2.md — Wysidown", "Untitled.md — Wysidown", "saved.md — Wysidown"]);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});
