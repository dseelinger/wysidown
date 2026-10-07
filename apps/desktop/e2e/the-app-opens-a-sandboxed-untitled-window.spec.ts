import { test } from "@playwright/test";
import { expect, launch, quit, title } from "./support.ts";

test("the app opens one untitled window with no console errors", async () => {
  const { app, window, errors } = await launch();
  try {
    await expect(window.locator(".ProseMirror")).toBeVisible();
    expect(await title(app)).toBe("Untitled — Wysidown");
    expect(app.windows()).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
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
      bridge: ["onMessage", "onSourceMode", "openFile", "post"],
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
