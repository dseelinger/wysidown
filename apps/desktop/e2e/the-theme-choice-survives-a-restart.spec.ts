import { test, type ElectronApplication } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, launch, menu, newFolder, quit, readText, userDataArgument } from "./support.ts";

/** The checked state and the enabled state of the View > Theme items, by id. */
async function themeItems(app: ElectronApplication): Promise<Record<string, [boolean, boolean]>> {
  return app.evaluate(({ Menu }) => {
    const items: Record<string, [boolean, boolean]> = {};
    for (const id of ["theme-vscode", "theme-github"]) {
      const item = Menu.getApplicationMenu()!.getMenuItemById(id)!;
      items[id] = [item.checked, item.enabled];
    }
    return items;
  });
}

test("a first run shows the VS Code theme, with GitHub available to choose", async () => {
  const { app, window, errors } = await launch();
  try {
    await expect(window.locator("body")).toHaveClass("wysidown-theme-vscode");
    expect(await themeItems(app)).toEqual({ "theme-vscode": [true, true], "theme-github": [false, true] });
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("the theme chosen from View > Theme is saved and shown again after a restart", async () => {
  const folder = newFolder();
  writeFileSync(join(folder, "settings.json"), JSON.stringify({ remoteImages: false, theme: "github" }));
  const first = await launch(userDataArgument(folder));
  try {
    await expect(first.window.locator("body")).toHaveClass("wysidown-theme-github");
    await expect(first.window.locator("#editor")).toHaveClass("markdown-body");
    expect((await themeItems(first.app))["theme-github"]?.[0]).toBe(true);
    await menu(first.app, "theme-vscode");
    await expect(first.window.locator("body")).toHaveClass("wysidown-theme-vscode");
    await expect(first.window.locator("#editor")).not.toHaveClass("markdown-body");
    await expect
      .poll(() => JSON.parse(readText(join(folder, "settings.json"))) as unknown)
      .toEqual({
        remoteImages: false,
        theme: "vscode",
      });
    expect(first.errors).toEqual([]);
  } finally {
    await quit(first.app);
  }

  const second = await launch(userDataArgument(folder));
  try {
    await expect(second.window.locator("body")).toHaveClass("wysidown-theme-vscode");
    expect((await themeItems(second.app))["theme-vscode"]?.[0]).toBe(true);
    expect(second.errors).toEqual([]);
  } finally {
    await quit(second.app);
  }
});
