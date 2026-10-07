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
 * Starts the built app with `args` on its command line and waits for its window. The app keeps its
 * settings in a new temporary folder unless `args` names one with `--user-data-dir=`. The window
 * is moved to the middle of a display other than the primary one when there is one, as the VS Code
 * tests do; windows the app opens later are placed beside it.
 */
export async function launch(...args: string[]): Promise<Launched> {
  const userData = args.some((a) => a.startsWith("--user-data-dir=")) ? [] : [userDataArgument(newFolder())];
  const app = await electron.launch({
    args: [join(import.meta.dirname, "..", "dist", "main.cjs"), ...userData, ...args],
  });
  const window = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, screen }) => {
    const primary = screen.getPrimaryDisplay();
    const other = screen.getAllDisplays().find((d) => d.id !== primary.id);
    if (!other) return;
    const area = other.workArea;
    for (const w of BrowserWindow.getAllWindows()) {
      const { width, height } = w.getBounds();
      const x = area.x + Math.max(0, Math.round((area.width - width) / 2));
      const y = area.y + Math.max(0, Math.round((area.height - height) / 2));
      w.setBounds({ x, y, width: Math.min(width, area.width), height: Math.min(height, area.height) });
    }
  });
  const errors: string[] = [];
  window.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    if (missingImage(m.text(), m.location().url)) return;
    errors.push(m.text());
  });
  window.on("pageerror", (e) => errors.push(e.message));
  await window.waitForLoadState("domcontentloaded");
  return { app, window, errors };
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

export function writeText(path: string, text: string): void {
  writeFileSync(path, text, "utf8");
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

/** Clicks a menu item by its id. */
export async function menu(
  app: ElectronApplication,
  id: "open" | "save" | "save-as" | "remote-images" | "source-mode",
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

/** Makes the next save dialog choose `path`. */
export async function chooseToSaveAs(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    Object.assign(dialog, { showSaveDialog: () => Promise.resolve({ canceled: false, filePath }) });
  }, path);
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
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle());
}

/** Closes the app, discarding unsaved changes. */
export async function quit(app: ElectronApplication): Promise<void> {
  await answerMessageBoxes(app, "Don't Save");
  await app.close();
}
