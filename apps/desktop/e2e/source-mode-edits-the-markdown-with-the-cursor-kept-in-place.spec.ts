import { test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { clickAtEnd, copyFixture, expect, fixture, launch, menu, quit, save } from "./support.ts";

const name = "27-blog-post.md";
const blog = fixture(name);
const sentence = "That makes review painful.";
const lineEnd = "should be a one-word diff.";

test("source mode shows the markdown with the cursor where it was, and typing there saves only the typed bytes", async () => {
  const path = copyFixture(name);
  const { app, window, errors } = await launch(path);
  try {
    await clickAtEnd(window, sentence);
    await menu(app, "source-mode");
    const source = window.locator(".cm-content");
    await expect(source).toBeFocused();
    await expect(source).toContainText("`__strong__` turned into `**strong**`");
    await expect(window.locator(".ProseMirror")).toHaveCount(0);
    await window.keyboard.type(" Really.");
    const typed = blog.replace(lineEnd, lineEnd + " Really.");
    await save(app, path, typed);

    await menu(app, "source-mode");
    await expect(window.locator(".cm-content")).toHaveCount(0);
    await expect(window.locator(".ProseMirror")).toBeFocused();
    await window.keyboard.type(" Yes.");
    await save(app, path, blog.replace(lineEnd, lineEnd + " Really. Yes."));
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("a line typed in source mode takes the file's CRLF line endings and keeps its byte order mark", async () => {
  const original = "﻿" + blog.replaceAll("\n", "\r\n");
  const path = copyFixture(name, () => original);
  const { app, window, errors } = await launch(path);
  try {
    await clickAtEnd(window, sentence);
    await menu(app, "source-mode");
    await expect(window.locator(".cm-content")).toBeFocused();
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await window.keyboard.type("A new paragraph.");
    await save(app, path, original.replace(lineEnd, lineEnd + "\r\n\r\nA new paragraph."));
    expect(readFileSync(path).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));

    await menu(app, "source-mode");
    await expect(window.locator(".ProseMirror p", { hasText: "A new paragraph." })).toHaveText("A new paragraph.");
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("a selection made in source mode is still selected after switching back", async () => {
  const path = copyFixture(name);
  const { app, window, errors } = await launch(path);
  try {
    await clickAtEnd(window, sentence);
    await menu(app, "source-mode");
    await expect(window.locator(".cm-content")).toBeFocused();
    await window.keyboard.press("Shift+Home");
    await menu(app, "source-mode");
    await expect(window.locator(".ProseMirror")).toBeFocused();
    expect(await window.evaluate(() => document.getSelection()?.toString())).toBe(
      "That makes review painful. A one-word change should be a one-word diff.",
    );
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});
