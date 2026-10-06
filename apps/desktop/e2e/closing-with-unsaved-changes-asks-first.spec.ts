import { test, type ElectronApplication } from "@playwright/test";
import {
  answerMessageBoxes,
  clickAtEnd,
  copyFixture,
  expect,
  fixture,
  launch,
  messageBoxes,
  readText,
  quit,
  title,
  type Launched,
} from "./support.ts";

const name = "27-blog-post.md";
const blog = fixture(name);
const sentence = "That makes review painful.";
const lineEnd = "should be a one-word diff.";

/** Opens a copy of the fixture and types into it, leaving unsaved changes. */
async function edited(): Promise<Launched & { path: string }> {
  const path = copyFixture(name);
  const launched = await launch(path);
  await clickAtEnd(launched.window, sentence);
  await launched.window.keyboard.type(" Really.");
  await expect.poll(() => title(launched.app)).toBe(`● ${name} — Wysidown`);
  return { ...launched, path };
}

async function closeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.close();
  });
}

test("Cancel keeps the window open and the file unchanged", async () => {
  const { app, errors, path } = await edited();
  try {
    await answerMessageBoxes(app, "Cancel");
    await closeWindow(app);
    await expect.poll(() => messageBoxes(app)).toEqual([`Save changes to ${name}?`]);
    expect(app.windows()).toHaveLength(1);
    expect(await title(app)).toBe(`● ${name} — Wysidown`);
    expect(readText(path)).toBe(blog);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("Don't Save closes the app and leaves the file unchanged", async () => {
  const { app, path } = await edited();
  await answerMessageBoxes(app, "Don't Save");
  const closed = app.waitForEvent("close");
  await closeWindow(app);
  await closed;
  expect(readText(path)).toBe(blog);
});

test("Save writes the changes and closes the app", async () => {
  const { app, path } = await edited();
  await answerMessageBoxes(app, "Save");
  const closed = app.waitForEvent("close");
  await closeWindow(app);
  await closed;
  expect(readText(path)).toBe(blog.replace(lineEnd, lineEnd + " Really."));
});

test("closing with no unsaved changes asks nothing", async () => {
  const { app } = await launch(copyFixture(name));
  await answerMessageBoxes(app, "Cancel");
  const closed = app.waitForEvent("close");
  await closeWindow(app);
  await closed;
});
