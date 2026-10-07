import { test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  copyFixture,
  expect,
  fixture,
  launch,
  newFolder,
  quit,
  readText,
  userDataArgument,
  type Launched,
} from "./support.ts";

const name = "35-inline-links.md";

/** Settings that keep images from the web off, so that no test reaches the network. */
function offline(): string {
  const folder = newFolder();
  writeFileSync(join(folder, "settings.json"), JSON.stringify({ remoteImages: false }));
  return userDataArgument(folder);
}

/** Makes `shell.openExternal` record each address in `globalThis.opened` of the main process instead of opening it. */
async function recordOpened({ app }: Launched): Promise<void> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { opened });
    Object.assign(shell, {
      openExternal: (url: string) => {
        opened.push(url);
        return Promise.resolve();
      },
    });
  });
}

async function opened({ app }: Launched): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
}

test("Ctrl+click and Open on a link to the web or mail open it in the default program", async () => {
  const path = copyFixture(name, (text) => text + "\nWrite to [the team](mailto:team@example.com).\n");
  const launched = await launch(offline(), path);
  const { app, window, errors } = launched;
  try {
    await recordOpened(launched);
    await window.locator("a", { hasText: "the docs" }).click({ modifiers: ["Control"] });
    await expect.poll(() => opened(launched)).toEqual(["https://example.com/docs"]);
    await window.locator("a", { hasText: "the team" }).click();
    await window.getByRole("dialog", { name: "Link" }).getByRole("button", { name: "Open" }).click();
    await expect.poll(() => opened(launched)).toEqual(["https://example.com/docs", "mailto:team@example.com"]);
    expect(errors).toEqual([]);
    expect(readText(path)).toBe(fixture(name) + "\nWrite to [the team](mailto:team@example.com).\n");
  } finally {
    await quit(app);
  }
});

test("the app opens no address with another scheme, whatever the page asks", async () => {
  const launched = await launch(offline(), copyFixture(name));
  const { app, window, errors } = launched;
  try {
    await recordOpened(launched);
    await window.evaluate(() => {
      const bridge = (globalThis as unknown as { wysidown: { post(message: unknown): void } }).wysidown;
      for (const href of [
        "file:///C:/Windows/System32/notepad.exe",
        "javascript:alert(1)",
        "ms-settings:privacy",
        "\\\\server\\share\\run.exe",
        "https://example.com/last",
      ]) {
        bridge.post({ type: "open", href });
      }
    });
    await expect.poll(() => opened(launched)).toEqual(["https://example.com/last"]);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});
