import { test, type Page } from "@playwright/test";
import {
  answerMessageBoxes,
  chooseToOpen,
  clickAtEnd,
  clickTab,
  copyFixture,
  documentBounds,
  documentPage,
  expect,
  fixture,
  launch,
  menu,
  panes,
  pressCtrl,
  pressCtrlAlt,
  quit,
  readText,
  save,
  tabRowIsBehind,
  tabRowPage,
  title,
  type Launched,
} from "./support.ts";

const blogName = "27-blog-post.md";
const blogSentence = "That makes review painful.";
const blogHeading = 'What "fidelity" means';
const listsName = "04-lists-nested.md";

/**
 * Opens a copy of the blog post, splits it into the right pane with Ctrl+\, and opens a copy of
 * the lists fixture in the left pane, which it replaces the untitled tab in.
 */
async function split(): Promise<Launched & { blog: string; lists: string; blogPage: Page; listsPage: Page }> {
  const blog = copyFixture(blogName);
  const lists = copyFixture(listsName);
  const launched = await launch(blog);
  const { app, window } = launched;
  await expect(window.getByText(blogSentence)).toBeVisible();
  await pressCtrl(app, window, "\\");
  await expect.poll(() => panes(app)).toEqual([["Untitled.md (active)"], [`${blogName} (active)`, "(focused)"]]);
  await clickTab(app, "Untitled.md");
  await expect.poll(() => panes(app)).toEqual([["Untitled.md (active)", "(focused)"], [`${blogName} (active)`]]);
  await chooseToOpen(app, lists);
  await menu(app, "open");
  await expect.poll(() => panes(app)).toEqual([[`${listsName} (active)`, "(focused)"], [`${blogName} (active)`]]);
  const listsPage = await documentPage(app, "Pears");
  return { ...launched, blog, lists, blogPage: window, listsPage };
}

test("Ctrl+\\ splits the window, and a file edited in each pane saves only its typed bytes", async () => {
  const { app, errors, blog, lists, blogPage, listsPage } = await split();
  try {
    const { views, width } = await documentBounds(app);
    expect(views).toHaveLength(2);
    expect(views[0]![1] + views[1]![1]).toBeGreaterThan(width - 10);
    await expect(blogPage.getByText(blogSentence)).toBeVisible();

    await clickAtEnd(listsPage, "Pears");
    await listsPage.keyboard.type(" and figs");
    await save(app, lists, fixture(listsName).replace("  - Pears\n", "  - Pears and figs\n"));
    expect(readText(blog)).toBe(fixture(blogName));

    await clickTab(app, blogName);
    await expect.poll(() => panes(app)).toEqual([[`${listsName} (active)`], [`${blogName} (active)`, "(focused)"]]);
    await clickAtEnd(blogPage, blogHeading);
    expect(await title(app)).toBe(`${blogName} — Wysidown`);
    await blogPage.keyboard.type(" to us");
    await save(app, blog, fixture(blogName).replace(blogHeading, blogHeading + " to us"));
    expect(readText(lists)).toBe(fixture(listsName).replace("  - Pears\n", "  - Pears and figs\n"));
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("Ctrl+W and the menu act on the focused pane", async () => {
  const { app, errors, listsPage } = await split();
  try {
    await clickTab(app, blogName);
    await menu(app, "new");
    await expect
      .poll(() => panes(app))
      .toEqual([[`${listsName} (active)`], [blogName, "Untitled.md (active)", "(focused)"]]);
    expect(await title(app)).toBe("Untitled.md — Wysidown");

    await pressCtrl(app, listsPage, "N");
    await expect
      .poll(() => panes(app))
      .toEqual([
        [listsName, "Untitled-2.md (active)", "(focused)"],
        [blogName, "Untitled.md (active)"],
      ]);
    await pressCtrl(app, await tabRowPage(app), "W");
    await expect
      .poll(() => panes(app))
      .toEqual([
        [`${listsName} (active)`, "(focused)"],
        [blogName, "Untitled.md (active)"],
      ]);
    await pressCtrl(app, listsPage, "Tab");
    expect(await panes(app)).toEqual([
      [`${listsName} (active)`, "(focused)"],
      [blogName, "Untitled.md (active)"],
    ]);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("a tab moved to the other pane keeps its unsaved changes, and saves only its typed bytes", async () => {
  const { app, errors, blog, blogPage } = await split();
  try {
    await clickTab(app, blogName);
    await clickAtEnd(blogPage, blogHeading);
    await blogPage.keyboard.type(" to us");
    await expect.poll(() => panes(app)).toEqual([[`${listsName} (active)`], [`● ${blogName} (active)`, "(focused)"]]);

    await pressCtrlAlt(app, blogPage, "Left");
    await expect.poll(() => panes(app)).toEqual([[listsName, `● ${blogName} (active)`]]);
    expect((await documentBounds(app)).views).toHaveLength(1);
    await expect(blogPage.getByText(blogHeading + " to us")).toBeVisible();

    await menu(app, "move-to-other-pane");
    await expect.poll(() => panes(app)).toEqual([[`${listsName} (active)`], [`● ${blogName} (active)`, "(focused)"]]);
    await pressCtrl(app, blogPage, "\\");
    await expect.poll(() => panes(app)).toEqual([[listsName, `● ${blogName} (active)`]]);
    await pressCtrlAlt(app, blogPage, "Right");
    await expect.poll(() => panes(app)).toEqual([[`${listsName} (active)`], [`● ${blogName} (active)`, "(focused)"]]);

    await save(app, blog, fixture(blogName).replace(blogHeading, blogHeading + " to us"));
    await expect.poll(() => panes(app)).toEqual([[`${listsName} (active)`], [`${blogName} (active)`, "(focused)"]]);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("closing the right pane's last tab gives the left pane the whole window", async () => {
  const { app, errors, listsPage } = await split();
  try {
    await answerMessageBoxes(app, "Cancel");
    await clickTab(app, blogName);
    await menu(app, "close-tab");
    await expect.poll(() => panes(app)).toEqual([[`${listsName} (active)`]]);
    const { views, width } = await documentBounds(app);
    expect(views).toEqual([[0, width]]);
    expect(await title(app)).toBe(`${listsName} — Wysidown`);
    await expect(listsPage.locator(".ProseMirror")).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("opening a file open in the other pane shows its tab and focuses that pane", async () => {
  const { app, errors, blog } = await split();
  try {
    await chooseToOpen(app, blog);
    await menu(app, "open");
    await expect.poll(() => panes(app)).toEqual([[`${listsName} (active)`], [`${blogName} (active)`, "(focused)"]]);
    expect(await title(app)).toBe(`${blogName} — Wysidown`);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("dragging the splitter resizes both panes, stops at 200 px, and a double-click makes them equal", async () => {
  const { app, errors } = await split();
  try {
    const row = await tabRowPage(app);
    const before = await documentBounds(app);
    const splitter = await row.locator("#splitter").boundingBox();
    if (!splitter) throw new Error("the splitter is not shown");
    const y = splitter.y + 200;
    const middle = splitter.x + splitter.width / 2;

    await row.mouse.move(middle, y);
    await row.mouse.down();
    await row.mouse.move(middle - 150, y, { steps: 5 });
    await expect.poll(() => tabRowIsBehind(app)).toBe(false);
    await row.mouse.up();
    await expect.poll(() => tabRowIsBehind(app)).toBe(true);
    const moved = await documentBounds(app);
    expect(moved.views[0]![1]).toBe(before.views[0]![1] - 150);
    expect(moved.views[1]![1]).toBe(before.views[1]![1] + 150);

    await row.mouse.move(middle - 150, y);
    await row.mouse.down();
    await row.mouse.move(10, y, { steps: 5 });
    await row.mouse.up();
    await expect.poll(async () => (await documentBounds(app)).views[0]![1]).toBe(200);
    const right = (await row.locator("#splitter").boundingBox())!;
    await row.mouse.move(right.x + 2, y);
    await row.mouse.down();
    await row.mouse.move(before.width - 10, y, { steps: 5 });
    await row.mouse.up();
    await expect.poll(async () => (await documentBounds(app)).views[1]![1]).toBe(200);

    const end = (await row.locator("#splitter").boundingBox())!;
    await row.mouse.dblclick(end.x + 2, y);
    await expect.poll(async () => (await documentBounds(app)).views).toEqual(before.views);
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});
