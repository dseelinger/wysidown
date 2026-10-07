import { test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { copyFixture, expect, launch, newFolder, quit, userDataArgument } from "./support.ts";

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
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .map((w) => w.getTitle())
            .sort(),
        ),
      )
      .toEqual(["25-changelog.md — Wysidown", "Untitled — Wysidown"]);
    const opened = app.windows().find((page) => page !== window);
    await expect(opened!.locator(".ProseMirror h1")).toHaveText("Changelog");
    await expect(window.locator(".ProseMirror h1")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});
