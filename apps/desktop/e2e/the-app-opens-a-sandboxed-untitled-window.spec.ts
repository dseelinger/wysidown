import { test } from "@playwright/test";
import {
  answerMessageBoxes,
  chooseToSaveAs,
  closeWindow,
  documentBounds,
  expect,
  launch,
  menu,
  messageBoxes,
  newPath,
  quit,
  readText,
  saveDialogDefaults,
  tabRowIsBehind,
  tabRowPage,
  tabs,
  title,
  windowCount,
} from "./support.ts";

test("the app opens one window on an empty Untitled.md with no console errors", async () => {
  const { app, window, errors } = await launch();
  try {
    await expect(window.locator(".ProseMirror")).toBeVisible();
    await expect(window.locator(".ProseMirror")).toHaveText("");
    expect(await title(app)).toBe("Untitled.md — Wysidown");
    expect(await windowCount(app)).toBe(1);
    expect(await tabs(app)).toEqual(["Untitled.md (active)"]);
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
    await closeWindow(app);
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
  await closeWindow(app);
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
    expect(await windowCount(app)).toBe(1);
    expect(app.windows()).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("the tab row has no Node access and reaches the main process only through its own bridge", async () => {
  const { app, errors } = await launch();
  try {
    const row = await tabRowPage(app);
    const page = await row.evaluate(() => ({
      require: typeof (globalThis as unknown as { require?: unknown }).require,
      process: typeof (globalThis as unknown as { process?: unknown }).process,
      editorBridge: typeof (globalThis as unknown as { wysidown?: unknown }).wysidown,
      bridge: Object.keys((globalThis as unknown as { wysidownTabs: object }).wysidownTabs).sort(),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
    }));
    expect(page).toEqual({
      require: "undefined",
      process: "undefined",
      editorBridge: "undefined",
      bridge: ["close", "drag", "dragEnd", "dragStart", "equalPanes", "focusPane", "newTab", "onTabs", "select"],
      csp: "default-src 'none'; script-src 'self'; style-src 'self'",
    });
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("the tab row cannot navigate away or open a window", async () => {
  const { app, errors } = await launch();
  try {
    const row = await tabRowPage(app);
    const url = row.url();
    await row.evaluate(() => {
      globalThis.open("https://example.com/");
      globalThis.location.href = "https://example.com/";
    });
    await row.waitForTimeout(500);
    expect(row.url()).toBe(url);
    expect(await windowCount(app)).toBe(1);
    expect(app.windows()).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("the tab row's requests naming a tab or pane the window does not have are ignored", async () => {
  const { app, errors } = await launch();
  try {
    const row = await tabRowPage(app);
    await row.evaluate(() => {
      const bridge = (
        globalThis as unknown as {
          wysidownTabs: {
            close(id: unknown): void;
            select(id: unknown): void;
            newTab(pane: unknown): void;
            focusPane(pane: unknown): void;
            dragStart(): void;
            drag(x: unknown): void;
          };
        }
      ).wysidownTabs;
      for (const id of [0, 999, "1", null]) {
        bridge.close(id);
        bridge.select(id);
      }
      for (const pane of [1, -1, 0.5, "0", null]) {
        bridge.newTab(pane);
        bridge.focusPane(pane);
      }
      bridge.dragStart();
      for (const x of [Number.NaN, Infinity, "300", null]) bridge.drag(x);
    });
    await row.waitForTimeout(500);
    expect(await windowCount(app)).toBe(1);
    expect(await tabs(app)).toEqual(["Untitled.md (active)"]);
    expect(await tabRowIsBehind(app)).toBe(true);
    expect((await documentBounds(app)).views).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});
