import { test, type ElectronApplication } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import {
  chooseToSaveAs,
  clickTab,
  copyFixture,
  documentPage,
  expect,
  launch,
  menu,
  newFolder,
  newPath,
  quit,
  tabs,
  title,
  userDataArgument,
  windowCount,
} from "./support.ts";

/** Launches the app a second time with `args`, as a user would from a shortcut, and waits for it to exit. */
async function launchAgain(app: ElectronApplication, args: string[], cwd?: string): Promise<void> {
  const electron = await app.evaluate(() => process.execPath);
  const main = join(import.meta.dirname, "..", "dist", "main.cjs");
  const second = spawnSync(electron, [main, ...args], { cwd, timeout: 30_000 });
  expect(second.status).toBe(0);
}

test("a second launch opens its file in a new tab of the running window and exits", async () => {
  const userData = userDataArgument(newFolder());
  const { app, window, errors } = await launch(userData);
  try {
    await expect(window.locator(".ProseMirror")).toBeVisible();
    await window.keyboard.type("Draft");
    await expect.poll(() => tabs(app)).toEqual(["● Untitled.md (active)"]);
    const path = copyFixture("25-changelog.md");
    // A relative path, so the file is found from the second launch's working folder.
    await launchAgain(app, [userData, basename(path)], dirname(path));

    await expect.poll(() => tabs(app)).toEqual(["● Untitled.md", "25-changelog.md (active)"]);
    expect(await windowCount(app)).toBe(1);
    expect(await title(app)).toBe("25-changelog.md — Wysidown");
    const opened = await documentPage(app, "Changelog");
    await expect(opened.locator(".ProseMirror h1")).toHaveText("Changelog");
    await expect(window.locator(".ProseMirror")).toHaveText("Draft");
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("a second launch with no file adds an untitled tab, and each takes the lowest Untitled number not in use", async () => {
  const userData = userDataArgument(newFolder());
  const { app, window, errors } = await launch(userData);
  try {
    await expect(window.locator(".ProseMirror")).toBeVisible();
    await launchAgain(app, [userData]);
    await expect.poll(() => tabs(app)).toEqual(["Untitled.md", "Untitled-2.md (active)"]);
    expect(await windowCount(app)).toBe(1);

    await clickTab(app, "Untitled.md");
    await expect.poll(() => tabs(app)).toEqual(["Untitled.md (active)", "Untitled-2.md"]);
    const path = newPath("saved.md");
    await chooseToSaveAs(app, path);
    await menu(app, "save");
    await expect.poll(() => tabs(app)).toEqual(["saved.md (active)", "Untitled-2.md"]);

    await launchAgain(app, [userData]);
    await expect.poll(() => tabs(app)).toEqual(["saved.md", "Untitled.md (active)", "Untitled-2.md"]);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});
