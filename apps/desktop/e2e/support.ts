import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export { expect };

export interface Launched {
  app: ElectronApplication;
  window: Page;
  /** Console errors, console warnings and page errors seen so far, except for images on disk that are not found. */
  errors: string[];
}

/**
 * Starts the built app with `args` on its command line and waits for its document page. The app
 * keeps its settings in a new temporary folder unless `args` names one with `--user-data-dir=`.
 * The window is moved to the middle of a display other than the primary one when there is one, as
 * the VS Code tests do; windows the app opens later are placed beside it. `errors` collects from
 * every page the app opens, the tab row's included.
 */
export async function launch(...args: string[]): Promise<Launched> {
  const userData = args.some((a) => a.startsWith("--user-data-dir=")) ? [] : [userDataArgument(newFolder())];
  const app = await electron.launch({
    args: [join(import.meta.dirname, "..", "dist", "main.cjs"), ...userData, ...args],
  });
  const errors: string[] = [];
  const watch = (page: Page): void => {
    page.on("console", (m) => {
      if (m.type() !== "error" && m.type() !== "warning") return;
      if (missingImage(m.text(), m.location().url)) return;
      errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
  };
  app.on("window", watch);
  for (const page of app.windows()) watch(page);
  const window = await documentPage(app);
  await app.evaluate(({ BaseWindow, screen }) => {
    const primary = screen.getPrimaryDisplay();
    const other = screen.getAllDisplays().find((d) => d.id !== primary.id);
    if (!other) return;
    const area = other.workArea;
    for (const w of BaseWindow.getAllWindows()) {
      const { width, height } = w.getBounds();
      const x = area.x + Math.max(0, Math.round((area.width - width) / 2));
      const y = area.y + Math.max(0, Math.round((area.height - height) / 2));
      w.setBounds({ x, y, width: Math.min(width, area.width), height: Math.min(height, area.height) });
    }
  });
  await window.waitForLoadState("domcontentloaded");
  return { app, window, errors };
}

/** True for a page showing a document, as against a tab row. */
function isDocument(page: Page): boolean {
  return page.url().endsWith("/renderer/index.html");
}

/**
 * The page of the document that contains `text`, or of the first document when `text` is not
 * given. Waits for it to appear.
 */
export async function documentPage(app: ElectronApplication, text?: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const page of app.windows().filter(isDocument)) {
        if (text === undefined || (await page.getByText(text).count()) > 0) {
          found = page;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  return found!;
}

/** The pages of every open document. */
export function documentPages(app: ElectronApplication): Page[] {
  return app.windows().filter(isDocument);
}

/** The tab row page of the app's only window. */
export async function tabRowPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((p) => p.url().endsWith("/renderer/tab-row.html"))).toBe(true);
  return app.windows().find((p) => p.url().endsWith("/renderer/tab-row.html"))!;
}

/** The tab row's tabs, in order, across every pane: as `panes` gives them. */
export async function tabs(app: ElectronApplication): Promise<string[]> {
  return (await panes(app)).flat();
}

/**
 * Each pane's tabs, left to right and in order: each name, after `● ` when it has unsaved changes
 * and before ` (active)` for the one its pane shows. The focused pane's list ends with `(focused)`
 * when there are two panes.
 */
export async function panes(app: ElectronApplication): Promise<string[][]> {
  const row = await tabRowPage(app);
  return row.evaluate(() => {
    const all = [...document.querySelectorAll(".pane")];
    return all.map((pane) => [
      ...[...pane.querySelectorAll(".tab")].map(
        (tab) =>
          (tab.classList.contains("dirty") ? "● " : "") +
          (tab.querySelector(".name")?.textContent ?? "") +
          (tab.getAttribute("aria-selected") === "true" ? " (active)" : ""),
      ),
      ...(all.length > 1 && pane.classList.contains("focused") ? ["(focused)"] : []),
    ]);
  });
}

/** The x and width of every shown document view, left to right, and the window's content width. */
export async function documentBounds(app: ElectronApplication): Promise<{ views: [number, number][]; width: number }> {
  return app.evaluate(({ BaseWindow, WebContentsView }) => {
    const win = BaseWindow.getAllWindows()[0]!;
    const views = win.contentView.children
      .filter((v): v is Electron.WebContentsView => v instanceof WebContentsView)
      .filter((v) => v.getVisible() && v.webContents.getURL().endsWith("/renderer/index.html"))
      .map((v) => v.getBounds())
      .sort((a, b) => a.x - b.x)
      .map((b): [number, number] => [b.x, b.width]);
    return { views, width: win.getContentBounds().width };
  });
}

/** True when the tab row page is the window's bottom view, behind every document. */
export async function tabRowIsBehind(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BaseWindow, WebContentsView }) => {
    const first = BaseWindow.getAllWindows()[0]!.contentView.children[0];
    return first instanceof WebContentsView && first.webContents.getURL().endsWith("/renderer/tab-row.html");
  });
}

/** Clicks the tab named `name` in the tab row. */
export async function clickTab(app: ElectronApplication, name: string): Promise<void> {
  const row = await tabRowPage(app);
  await row
    .locator(".tab")
    .filter({ has: row.locator(".name").getByText(name, { exact: true }) })
    .click();
}

/**
 * Presses `key` with Ctrl, and Shift when `shift` is true, in `page`. The key goes through the
 * main process's input handling as a typed key does, which Playwright's own key presses do not.
 */
export async function pressCtrl(app: ElectronApplication, page: Page, key: string, shift = false): Promise<void> {
  await press(app, page, key, shift ? ["control", "shift"] : ["control"]);
}

/** Presses `key` with Ctrl and Alt in `page`, through the main process's input handling as `pressCtrl` does. */
export async function pressCtrlAlt(app: ElectronApplication, page: Page, key: string): Promise<void> {
  await press(app, page, key, ["control", "alt"]);
}

async function press(
  app: ElectronApplication,
  page: Page,
  key: string,
  modifiers: ("control" | "shift" | "alt")[],
): Promise<void> {
  await page.evaluate(() => {
    Object.assign(globalThis, { pressCtrlTarget: true });
  });
  await app.evaluate(
    async ({ webContents }, { keyCode, modifiers }) => {
      let target: Electron.WebContents | undefined;
      for (const contents of webContents.getAllWebContents()) {
        if ((await contents.executeJavaScript("globalThis.pressCtrlTarget === true")) === true) target = contents;
      }
      if (!target) throw new Error("the page was not found");
      await target.executeJavaScript("delete globalThis.pressCtrlTarget");
      target.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      target.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    },
    { keyCode: key, modifiers },
  );
}

/** The number of the app's windows. */
export async function windowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length);
}

/** Closes the app's first window, as its close button does. */
export async function closeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BaseWindow }) => {
    BaseWindow.getAllWindows()[0]!.close();
  });
}

/**
 * True for the console error Chromium logs when an image the document names is not on disk, or
 * the app refuses it: the fixtures are copied without their images.
 */
function missingImage(text: string, url: string): boolean {
  return (
    url.startsWith("wysidown-file:") &&
    text === "Failed to load resource: the server responded with a status of 404 (Not Found)"
  );
}

/** A realistic corpus fixture's text. */
export function fixture(name: string): string {
  return readFileSync(fixturePath(name), "utf8");
}

/** Copies a realistic corpus fixture into a new temporary folder, optionally changing its text, and returns the copy's path. */
export function copyFixture(name: string, change?: (text: string) => string): string {
  const path = join(mkdtempSync(join(tmpdir(), "wysidown-")), name);
  copyFileSync(fixturePath(name), path);
  if (change) writeText(path, change(fixture(name)));
  return path;
}

/** A path in a new temporary folder; the file does not exist. */
export function newPath(name: string): string {
  return join(newFolder(), name);
}

/** A new, empty temporary folder. */
export function newFolder(): string {
  return mkdtempSync(join(tmpdir(), "wysidown-"));
}

/** The argument that makes the app keep its settings in `folder`. */
export function userDataArgument(folder: string): string {
  return `--user-data-dir=${folder.replaceAll("\\", "/")}`;
}

/** The argument that makes the app keep its settings in a new folder, with images from the web turned off so it does not reach the network. */
export function offline(): string {
  const folder = newFolder();
  writeFileSync(join(folder, "settings.json"), JSON.stringify({ remoteImages: false }));
  return userDataArgument(folder);
}

export function writeText(path: string, text: string): void {
  writeFileSync(path, text, "utf8");
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

/** Clicks a menu item by its id. */
export async function menu(
  app: ElectronApplication,
  id:
    | "new"
    | "open"
    | "save"
    | "save-as"
    | "close-tab"
    | "find"
    | "replace"
    | "remote-images"
    | "source-mode"
    | "split-right"
    | "move-to-other-pane"
    | "theme-vscode"
    | "theme-github",
): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById(itemId)!;
    (item.click as () => void)();
  }, id);
}

/** Makes the next open dialog choose `path`. */
export async function chooseToOpen(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    Object.assign(dialog, { showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [filePath] }) });
  }, path);
}

/**
 * Makes the next save dialog choose `path`, and records each dialog's default path in
 * `globalThis.saveDialogDefaults` of the main process.
 */
export async function chooseToSaveAs(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    const seen: (string | undefined)[] = [];
    Object.assign(globalThis, { saveDialogDefaults: seen });
    Object.assign(dialog, {
      showSaveDialog: (_window: unknown, options: { defaultPath?: string }) => {
        seen.push(options.defaultPath);
        return Promise.resolve({ canceled: false, filePath });
      },
    });
  }, path);
}

/** The default paths of the save dialogs shown since `chooseToSaveAs`. */
export async function saveDialogDefaults(app: ElectronApplication): Promise<(string | undefined)[]> {
  return app.evaluate(
    () => (globalThis as unknown as { saveDialogDefaults: (string | undefined)[] }).saveDialogDefaults,
  );
}

/**
 * Makes every message box answer with the button labelled `button`, and records each box's message in
 * `globalThis.messageBoxes` of the main process.
 */
export async function answerMessageBoxes(app: ElectronApplication, button: string): Promise<void> {
  await app.evaluate(({ dialog }, label) => {
    const seen: string[] = [];
    Object.assign(globalThis, { messageBoxes: seen });
    Object.assign(dialog, {
      showMessageBox: (_window: unknown, options: { message: string; buttons?: string[] }) => {
        seen.push(options.message);
        return Promise.resolve({ response: Math.max(0, options.buttons?.indexOf(label) ?? 0), checkboxChecked: false });
      },
    });
  }, button);
}

/** The messages of the message boxes shown since `answerMessageBoxes`. */
export async function messageBoxes(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { messageBoxes: string[] }).messageBoxes);
}

/** Clicks the end of the text `text` in the editor and waits for the editor to read the caret there. */
export async function clickAtEnd(window: Page, text: string): Promise<void> {
  const target = window.getByText(text);
  await target.evaluate((element) => {
    const page = globalThis as unknown as { caretAtEnd: boolean };
    page.caretAtEnd = false;
    // Added after the editor's own selectionchange listener, so it runs after the editor has read the selection.
    const listener = (): void => {
      const selection = document.getSelection();
      if (!selection?.isCollapsed || !selection.focusNode || !element.contains(selection.focusNode)) return;
      const rest = document.createRange();
      rest.setStart(selection.focusNode, selection.focusOffset);
      rest.setEnd(element, element.childNodes.length);
      if (rest.toString() !== "") return;
      page.caretAtEnd = true;
      document.removeEventListener("selectionchange", listener);
    };
    document.addEventListener("selectionchange", listener);
  });
  await target.click();
  await window.keyboard.press("End");
  await expect
    .poll(() => window.evaluate(() => (globalThis as unknown as { caretAtEnd: boolean }).caretAtEnd))
    .toBe(true);
}

/** Clicks File > Save once and waits for the file at `path` to hold `expected`. */
export async function save(app: ElectronApplication, path: string, expected: string): Promise<void> {
  await menu(app, "save");
  await expect.poll(() => (existsSync(path) ? readFileSync(path, "utf8") : null)).toBe(expected);
}

function fixturePath(name: string): string {
  let dir = import.meta.dirname;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    if (dirname(dir) === dir) throw new Error("pnpm-workspace.yaml not found above " + import.meta.dirname);
    dir = dirname(dir);
  }
  return join(dir, "packages", "core", "test", "corpus", "realistic", name);
}

/** The window's title bar text. */
export async function title(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.getTitle());
}

/** Closes the app, discarding unsaved changes. */
export async function quit(app: ElectronApplication): Promise<void> {
  await answerMessageBoxes(app, "Don't Save");
  await app.close();
}
