import { test } from "@playwright/test";
import {
  answerMessageBoxes,
  chooseToSaveAs,
  expect,
  launch,
  menu,
  messageBoxes,
  newPath,
  quit,
  readText,
  saveDialogDefaults,
  title,
} from "./support.ts";

test("the app opens one window on an empty Untitled.md with no console errors", async () => {
  const { app, window, errors } = await launch();
  try {
    await expect(window.locator(".ProseMirror")).toBeVisible();
    await expect(window.locator(".ProseMirror")).toHaveText("");
    expect(await title(app)).toBe("Untitled.md — Wysidown");
    expect(app.windows()).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("typing goes into the untitled document without a click, and Save asks where to save it", async () => {
  const path = newPath("typed.md");
  const { app, window, errors } = await launch();
  try {
    await expect(window.locator(".ProseMirror")).toBeFocused();
    await window.keyboard.type("Hello, world");
    await expect.poll(() => title(app)).toBe("● Untitled.md — Wysidown");
    await answerMessageBoxes(app, "Cancel");
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.close();
    });
    await expect.poll(() => messageBoxes(app)).toEqual(["Save changes to Untitled.md?"]);
    await chooseToSaveAs(app, path);
    await menu(app, "save");
    await expect.poll(() => title(app)).toBe("typed.md — Wysidown");
    expect(readText(path)).toBe("Hello, world");
    expect(await saveDialogDefaults(app)).toEqual(["Untitled.md"]);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("closing an untitled document with no edits asks nothing", async () => {
  const { app } = await launch();
  await answerMessageBoxes(app, "Cancel");
  const closed = app.waitForEvent("close");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.close();
  });
  await closed;
});

test("the page has no Node access and reaches the main process only through the bridge", async () => {
  const { app, window, errors } = await launch();
  try {
    const page = await window.evaluate(() => ({
      require: typeof (globalThis as unknown as { require?: unknown }).require,
      process: typeof (globalThis as unknown as { process?: unknown }).process,
      bridge: Object.keys((globalThis as unknown as { wysidown: object }).wysidown).sort(),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
    }));
    expect(page).toEqual({
      require: "undefined",
      process: "undefined",
      bridge: ["onFind", "onMessage", "onSourceMode", "onTheme", "openFile", "post"],
      csp: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' wysidown-file: https: data:; font-src 'self'",
    });
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("the page cannot navigate away or open a window", async () => {
  const { app, window, errors } = await launch();
  try {
    const url = window.url();
    await window.evaluate(() => {
      globalThis.open("https://example.com/");
      globalThis.location.href = "https://example.com/";
    });
    await window.waitForTimeout(500);
    expect(window.url()).toBe(url);
    expect(app.windows()).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});
