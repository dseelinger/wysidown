import { test, type Page } from "@playwright/test";
import {
  answerMessageBoxes,
  chooseToOpen,
  clickAtEnd,
  clickTab,
  closeWindow,
  copyFixture,
  documentPage,
  expect,
  fixture,
  launch,
  menu,
  messageBoxes,
  pressCtrl,
  quit,
  readText,
  save,
  tabRowPage,
  tabs,
  title,
  windowCount,
  type Launched,
} from "./support.ts";

const blogName = "27-blog-post.md";
const blogSentence = "That makes review painful.";
const blogLineEnd = "should be a one-word diff.";
const listsName = "04-lists-nested.md";

/** Opens copies of two fixtures in one window, the blog post first, and returns their paths and pages. */
async function twoTabs(): Promise<Launched & { blog: string; lists: string; blogPage: Page; listsPage: Page }> {
  const blog = copyFixture(blogName);
  const lists = copyFixture(listsName);
  const launched = await launch(blog);
  await expect(launched.window.getByText(blogSentence)).toBeVisible();
  await chooseToOpen(launched.app, lists);
  await menu(launched.app, "open");
  await expect.poll(() => tabs(launched.app)).toEqual([blogName, `${listsName} (active)`]);
  const listsPage = await documentPage(launched.app, "Pears");
  return { ...launched, blog, lists, blogPage: launched.window, listsPage };
}

test("two files open as two tabs, switch by key and by click, and each saves only its typed bytes", async () => {
  const { app, errors, blog, lists, blogPage, listsPage } = await twoTabs();
  try {
    await clickAtEnd(listsPage, "Pears");
    await listsPage.keyboard.type(" and figs");
    await expect.poll(() => tabs(app)).toEqual([blogName, `● ${listsName} (active)`]);

    await pressCtrl(app, listsPage, "Tab");
    await expect.poll(() => tabs(app)).toEqual([`${blogName} (active)`, `● ${listsName}`]);
    expect(await title(app)).toBe(`${blogName} — Wysidown`);
    await expect(blogPage.locator(".ProseMirror")).toBeFocused();
    await clickAtEnd(blogPage, blogSentence);
    await blogPage.keyboard.type(" Really.");
    await expect.poll(() => tabs(app)).toEqual([`● ${blogName} (active)`, `● ${listsName}`]);
    await save(app, blog, fixture(blogName).replace(blogLineEnd, blogLineEnd + " Really."));
    expect(readText(lists)).toBe(fixture(listsName));

    await clickTab(app, listsName);
    await expect.poll(() => tabs(app)).toEqual([blogName, `● ${listsName} (active)`]);
    expect(await title(app)).toBe(`● ${listsName} — Wysidown`);
    await save(app, lists, fixture(listsName).replace("  - Pears\n", "  - Pears and figs\n"));
    await expect.poll(() => tabs(app)).toEqual([blogName, `${listsName} (active)`]);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("Ctrl+Shift+Tab, Ctrl+PageUp and Ctrl+PageDown move between tabs, wrapping at the ends", async () => {
  const { app, errors, blogPage, listsPage } = await twoTabs();
  try {
    await pressCtrl(app, listsPage, "Tab", true);
    await expect.poll(() => tabs(app)).toEqual([`${blogName} (active)`, listsName]);
    await pressCtrl(app, blogPage, "Tab", true);
    await expect.poll(() => tabs(app)).toEqual([blogName, `${listsName} (active)`]);
    await pressCtrl(app, listsPage, "PageDown");
    await expect.poll(() => tabs(app)).toEqual([`${blogName} (active)`, listsName]);
    await pressCtrl(app, blogPage, "PageUp");
    await expect.poll(() => tabs(app)).toEqual([blogName, `${listsName} (active)`]);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("Ctrl+N opens an untitled tab after the active one, and the tab row's + does the same", async () => {
  const { app, errors, blogPage } = await twoTabs();
  try {
    await clickTab(app, blogName);
    await expect.poll(() => tabs(app)).toEqual([`${blogName} (active)`, listsName]);
    await pressCtrl(app, blogPage, "N");
    await expect.poll(() => tabs(app)).toEqual([blogName, "Untitled.md (active)", listsName]);
    expect(await title(app)).toBe("Untitled.md — Wysidown");
    await (await tabRowPage(app)).locator("#new").click();
    await expect.poll(() => tabs(app)).toEqual([blogName, "Untitled.md", "Untitled-2.md (active)", listsName]);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("Ctrl+W on a tab with unsaved changes asks first: Cancel keeps it, Don't Save closes it", async () => {
  const { app, errors, blog, listsPage } = await twoTabs();
  try {
    await clickAtEnd(listsPage, "Pears");
    await listsPage.keyboard.type(" and figs");
    await expect.poll(() => tabs(app)).toEqual([blogName, `● ${listsName} (active)`]);

    await answerMessageBoxes(app, "Cancel");
    await pressCtrl(app, listsPage, "W");
    await expect.poll(() => messageBoxes(app)).toEqual([`Save changes to ${listsName}?`]);
    expect(await tabs(app)).toEqual([blogName, `● ${listsName} (active)`]);

    await answerMessageBoxes(app, "Don't Save");
    await pressCtrl(app, listsPage, "W");
    await expect.poll(() => tabs(app)).toEqual([`${blogName} (active)`]);
    expect(await messageBoxes(app)).toEqual([`Save changes to ${listsName}?`]);
    expect(await title(app)).toBe(`${blogName} — Wysidown`);
    expect(readText(blog)).toBe(fixture(blogName));
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("a tab with no unsaved changes closes without asking, by its close button or a middle click", async () => {
  const { app, errors } = await twoTabs();
  try {
    await answerMessageBoxes(app, "Cancel");
    const row = await tabRowPage(app);
    await row.locator(".tab").nth(1).locator(".close").click();
    await expect.poll(() => tabs(app)).toEqual([`${blogName} (active)`]);
    await menu(app, "new");
    await expect.poll(() => tabs(app)).toEqual([blogName, "Untitled.md (active)"]);
    await row.locator(".tab").nth(0).click({ button: "middle" });
    await expect.poll(() => tabs(app)).toEqual(["Untitled.md (active)"]);
    expect(await messageBoxes(app)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("closing the last tab closes the window", async () => {
  const { app, window } = await launch();
  await expect(window.locator(".ProseMirror")).toBeVisible();
  const closed = app.waitForEvent("close");
  await menu(app, "close-tab");
  await closed;
});

test("closing the window asks about each tab with unsaved changes, and Cancel keeps every tab", async () => {
  const { app, errors, blog, lists, blogPage, listsPage } = await twoTabs();
  try {
    await clickAtEnd(listsPage, "Pears");
    await listsPage.keyboard.type(" and figs");
    await clickTab(app, blogName);
    await clickAtEnd(blogPage, blogSentence);
    await blogPage.keyboard.type(" Really.");
    await expect.poll(() => tabs(app)).toEqual([`● ${blogName} (active)`, `● ${listsName}`]);

    await answerMessageBoxes(app, "Cancel");
    await closeWindow(app);
    await expect.poll(() => messageBoxes(app)).toEqual([`Save changes to ${blogName}?`]);
    expect(await windowCount(app)).toBe(1);
    expect(await tabs(app)).toEqual([`● ${blogName} (active)`, `● ${listsName}`]);

    // Don't Save on the first tab moves on to the second, which is shown while it is asked about.
    await app.evaluate(({ dialog }) => {
      const seen: string[] = [];
      Object.assign(globalThis, { messageBoxes: seen });
      Object.assign(dialog, {
        showMessageBox: (_window: unknown, options: { message: string; buttons: string[] }) => {
          seen.push(options.message);
          return Promise.resolve({ response: options.buttons.indexOf(seen.length === 1 ? "Don't Save" : "Cancel") });
        },
      });
    });
    await closeWindow(app);
    await expect
      .poll(() => messageBoxes(app))
      .toEqual([`Save changes to ${blogName}?`, `Save changes to ${listsName}?`]);
    expect(await windowCount(app)).toBe(1);
    expect(await tabs(app)).toEqual([`● ${blogName}`, `● ${listsName} (active)`]);
    expect(readText(blog)).toBe(fixture(blogName));
    expect(readText(lists)).toBe(fixture(listsName));
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("closing the window with Don't Save for every changed tab closes the app and leaves the files unchanged", async () => {
  const { app, blog, lists, listsPage } = await twoTabs();
  await clickAtEnd(listsPage, "Pears");
  await listsPage.keyboard.type(" and figs");
  await expect.poll(() => tabs(app)).toEqual([blogName, `● ${listsName} (active)`]);
  await answerMessageBoxes(app, "Don't Save");
  const closed = app.waitForEvent("close");
  await closeWindow(app);
  await closed;
  expect(readText(blog)).toBe(fixture(blogName));
  expect(readText(lists)).toBe(fixture(listsName));
});
