import { test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import {
  answerMessageBoxes,
  chooseToOpen,
  chooseToSaveAs,
  clickAtEnd,
  copyFixture,
  documentPage,
  expect,
  fixture,
  launch,
  menu,
  messageBoxes,
  newPath,
  readText,
  quit,
  save,
  tabs,
  title,
} from "./support.ts";

const name = "27-blog-post.md";
const blog = fixture(name);
const sentence = "That makes review painful.";
const lineEnd = "should be a one-word diff.";
const typed = (text: string): string => text.replace(lineEnd, lineEnd + " Really.");

test("a file named on the command line opens, and saving after typing writes only the typed bytes", async () => {
  const path = copyFixture(name);
  const { app, window, errors } = await launch(path);
  try {
    await expect(window.getByText(sentence)).toBeVisible();
    expect(await title(app)).toBe(`${name} — Wysidown`);
    await clickAtEnd(window, sentence);
    await window.keyboard.type(" Really.");
    await expect.poll(() => title(app)).toBe(`● ${name} — Wysidown`);
    await save(app, path, typed(blog));
    await expect.poll(() => title(app)).toBe(`${name} — Wysidown`);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("saving straight after typing writes every typed character", async () => {
  const lists = "04-lists-nested.md";
  const path = copyFixture(lists);
  const { app, window, errors } = await launch(path);
  try {
    await clickAtEnd(window, "Pears");
    await window.keyboard.type(" and figs");
    await save(app, path, fixture(lists).replace("  - Pears\n", "  - Pears and figs\n"));
    await expect.poll(() => title(app)).toBe(`${lists} — Wysidown`);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("a file with CRLF line endings and a byte order mark keeps both when saved", async () => {
  const original = "﻿" + blog.replaceAll("\n", "\r\n");
  const path = copyFixture(name, () => original);
  const { app, window, errors } = await launch(path);
  try {
    await clickAtEnd(window, sentence);
    await window.keyboard.type(" Really.");
    await save(app, path, typed(original));
    expect(readFileSync(path).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("undoing back to the saved text clears the unsaved-changes marker", async () => {
  const path = copyFixture(name);
  const { app, window, errors } = await launch(path);
  try {
    await clickAtEnd(window, sentence);
    await window.keyboard.type("!");
    await expect.poll(() => title(app)).toBe(`● ${name} — Wysidown`);
    await window.keyboard.press("Control+z");
    await expect.poll(() => title(app)).toBe(`${name} — Wysidown`);
    expect(readText(path)).toBe(blog);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("Save As writes to the chosen file, leaves the original alone, and names the window after it", async () => {
  const path = copyFixture(name);
  const copy = newPath("copy.md");
  const { app, window, errors } = await launch(path);
  try {
    await clickAtEnd(window, sentence);
    await window.keyboard.type(" Really.");
    await expect.poll(() => title(app)).toBe(`● ${name} — Wysidown`);
    await chooseToSaveAs(app, copy);
    await menu(app, "save-as");
    await expect.poll(() => title(app)).toBe("copy.md — Wysidown");
    expect(readText(copy)).toBe(typed(blog));
    expect(readText(path)).toBe(blog);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("Save on an untitled document asks where to save it", async () => {
  const path = newPath("new.md");
  const { app, window, errors } = await launch();
  try {
    await window.locator(".ProseMirror").click();
    await window.keyboard.type("Hello");
    await expect.poll(() => title(app)).toBe("● Untitled.md — Wysidown");
    await chooseToSaveAs(app, path);
    await save(app, path, "Hello");
    await expect.poll(() => title(app)).toBe("new.md — Wysidown");
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("Open from a document with a file opens the chosen file in a new tab after it", async () => {
  const path = copyFixture("20-headings.md");
  const { app, window, errors } = await launch(copyFixture(name));
  try {
    await expect(window.getByText(sentence)).toBeVisible();
    await chooseToOpen(app, path);
    await menu(app, "open");
    await expect.poll(() => tabs(app)).toEqual([name, "20-headings.md (active)"]);
    const opened = await documentPage(app, "Setext heading level one");
    await expect(opened.getByText(sentence)).toHaveCount(0);
    await expect(window.getByText(sentence)).toBeVisible();
    expect(await title(app)).toBe("20-headings.md — Wysidown");
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("Open from an untitled document with no edits replaces it", async () => {
  const { app, window, errors } = await launch();
  try {
    await expect(window.locator(".ProseMirror")).toBeVisible();
    await chooseToOpen(app, copyFixture("20-headings.md"));
    await menu(app, "open");
    await expect(window.getByText("Setext heading level one")).toBeVisible();
    expect(await tabs(app)).toEqual(["20-headings.md (active)"]);
    expect(await title(app)).toBe("20-headings.md — Wysidown");
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("Open with unsaved changes asks nothing and keeps the changes in their own tab", async () => {
  const path = copyFixture(name);
  const { app, window, errors } = await launch(path);
  try {
    await clickAtEnd(window, sentence);
    await window.keyboard.type(" Really.");
    await expect.poll(() => title(app)).toBe(`● ${name} — Wysidown`);
    await answerMessageBoxes(app, "Cancel");
    await chooseToOpen(app, copyFixture("20-headings.md"));
    await menu(app, "open");
    await expect.poll(() => tabs(app)).toEqual([`● ${name}`, "20-headings.md (active)"]);
    expect(await messageBoxes(app)).toEqual([]);
    await expect(window.getByText(`${lineEnd} Really.`)).toBeVisible();
    expect(readText(path)).toBe(blog);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("opening a file that is already open shows its tab instead of a second copy", async () => {
  const path = copyFixture(name);
  const { app, errors } = await launch(path);
  try {
    await chooseToOpen(app, copyFixture("20-headings.md"));
    await menu(app, "open");
    await expect.poll(() => tabs(app)).toEqual([name, "20-headings.md (active)"]);
    await chooseToOpen(app, path.toUpperCase());
    await menu(app, "open");
    await expect.poll(() => tabs(app)).toEqual([`${name} (active)`, "20-headings.md"]);
    expect(await title(app)).toBe(`${name} — Wysidown`);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("a file that is not valid UTF-8 is refused and the document stays", async () => {
  const bad = newPath("latin1.md");
  writeFileSync(bad, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  const { app, window, errors } = await launch(copyFixture(name));
  try {
    await expect(window.getByText(sentence)).toBeVisible();
    await answerMessageBoxes(app, "OK");
    await chooseToOpen(app, bad);
    await menu(app, "open");
    await expect.poll(() => messageBoxes(app)).toEqual(["Wysidown cannot open latin1.md."]);
    await expect(window.getByText(sentence)).toBeVisible();
    expect(await title(app)).toBe(`${name} — Wysidown`);
    expect(await tabs(app)).toEqual([`${name} (active)`]);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});
