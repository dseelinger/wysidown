import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Frame,
  type Page,
} from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export { expect };

/** VS Code with the extension loaded and one markdown file open in Wysidown. */
export interface Opened {
  window: Page;
  /** The webview frame that holds the editor. */
  editor: Frame;
  /** Path of the open file, a copy in a new temporary folder. */
  path: string;
  /** Console errors and warnings that did not come from VS Code's own code. */
  errors: string[];
}

/** A test that opens a copy of a realistic corpus fixture in Wysidown and fails on any error from its webview. */
export const test = base.extend<{ open: (fixture: string) => Promise<Opened> }>({
  open: async ({ playwright: _playwright }, use) => {
    const apps: ElectronApplication[] = [];
    const opened: Opened[] = [];
    await use(async (name) => {
      const result = await open(name, apps);
      opened.push(result);
      return result;
    });
    const errors: string[] = [];
    for (const o of opened) errors.push(...o.errors, ...(o.editor.isDetached() ? [] : await uncaught(o.editor)));
    for (const app of apps) await app.close();
    expect(errors).toEqual([]);
  },
});

/** The repository root: the nearest ancestor holding pnpm-workspace.yaml. */
function repoRoot(): string {
  let dir = import.meta.dirname;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    if (dirname(dir) === dir) throw new Error("pnpm-workspace.yaml not found above " + import.meta.dirname);
    dir = dirname(dir);
  }
  return dir;
}

const extension = join(import.meta.dirname, "..");
const corpus = join(repoRoot(), "packages", "core", "test", "corpus", "realistic");

/** A realistic corpus fixture's text. */
export function fixture(name: string): string {
  return readFileSync(join(corpus, name), "utf8");
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

/** The VS Code executable the extension-host tests use, at the version `.vscode-test.mjs` names. */
async function vscodeExecutable(): Promise<string> {
  const config = (await import(pathToFileURL(join(extension, ".vscode-test.mjs")).href)) as {
    default: { version: string };
  };
  return downloadAndUnzipVSCode({ version: config.default.version, cachePath: join(extension, ".vscode-test") });
}

/**
 * Starts VS Code with its own settings and extensions folders, opening a copy of `name` with
 * Wysidown as the editor for markdown. The window is moved to a display other than the primary
 * one when there is one. Starts again when the file opened in the text editor instead.
 */
async function open(name: string, apps: ElectronApplication[]): Promise<Opened> {
  const executablePath = await vscodeExecutable();
  for (let attempt = 1; ; attempt++) {
    const root = mkdtempSync(join(tmpdir(), "wysidown-vscode-"));
    const folder = join(root, "work");
    const path = join(folder, name);
    const settings = join(root, "user-data", "User");
    mkdirSync(folder);
    mkdirSync(settings, { recursive: true });
    copyFileSync(join(corpus, name), path);
    writeFileSync(
      join(settings, "settings.json"),
      JSON.stringify({
        "workbench.editorAssociations": { "*.md": "wysidown.markdown" },
        "workbench.startupEditor": "none",
        "security.workspace.trust.enabled": false,
        "update.mode": "none",
        "telemetry.telemetryLevel": "off",
        "window.dialogStyle": "custom",
      }),
    );
    const app = await electron.launch({
      executablePath,
      args: [
        `--extensionDevelopmentPath=${extension}`,
        `--user-data-dir=${join(root, "user-data")}`,
        `--extensions-dir=${join(root, "extensions")}`,
        "--disable-extensions",
        "--skip-welcome",
        "--skip-release-notes",
        "--new-window",
        folder,
        path,
      ],
    });
    apps.push(app);
    const window = await app.firstWindow();
    await app.evaluate(({ BrowserWindow, screen }) => {
      const primary = screen.getPrimaryDisplay();
      const other = screen.getAllDisplays().find((d) => d.id !== primary.id);
      if (other) for (const w of BrowserWindow.getAllWindows()) w.setBounds(other.workArea);
    });
    const errors: string[] = [];
    window.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warning") && !fromVSCode(m.location().url)) errors.push(m.text());
    });
    const editor = await editorFrame(window);
    if (editor) {
      await recordErrors(editor);
      return { window, editor, path, errors };
    }
    base.info().annotations.push({ type: "relaunched", description: `${name} opened in the text editor` });
    if (attempt === 3) throw new Error(`${name} opened in the text editor ${String(attempt)} times, not in Wysidown`);
    await app.close();
  }
}

/** Records errors thrown in the editor's frame for `uncaught`. */
async function recordErrors(editor: Frame): Promise<void> {
  await editor.evaluate(() => {
    const errors: string[] = [];
    Object.assign(globalThis, { wysidownErrors: errors });
    globalThis.addEventListener("error", (e) => errors.push(e.message));
    globalThis.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
  });
}

/**
 * Waits for the editor to show a document in a new webview, after its old one was destroyed by
 * hiding or closing the tab, and makes it `o.editor`.
 */
export async function shownAgain(o: Opened): Promise<void> {
  await expect.poll(() => o.editor.isDetached()).toBe(true);
  const editor = await editorFrame(o.window);
  if (!editor) throw new Error("the editor did not show the document again");
  await recordErrors(editor);
  o.editor = editor;
}

/** True for a console message from VS Code itself: its installed code, or the page that hosts each webview. */
function fromVSCode(url: string): boolean {
  return url.startsWith("vscode-file://") || /^vscode-webview:\/\/[^/]+\/index\.html/.test(url);
}

/** Errors thrown in the editor's frame and not caught, since VS Code does not report them as page errors. */
async function uncaught(editor: Frame): Promise<string[]> {
  return editor.evaluate(() => (globalThis as unknown as { wysidownErrors: string[] }).wysidownErrors);
}

/** The frames holding an editor that shows a document. */
export async function editorFrames(window: Page): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (const frame of window.frames()) {
    const count = await frame
      .locator(".ProseMirror[contenteditable=true]")
      .count()
      .catch(() => 0);
    if (count > 0) frames.push(frame);
  }
  return frames;
}

/** The frame holding the editor, once it shows a document; null if none appears within 15 seconds. */
async function editorFrame(window: Page): Promise<Frame | null> {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const [frame] = await editorFrames(window);
    if (frame) return frame;
    await window.waitForTimeout(250);
  }
  return null;
}

/** Clicks the text `text` in the editor and waits for the editor to read the caret, then presses each of `keys`. */
export async function caret(o: Opened, text: string, ...keys: string[]): Promise<void> {
  await o.editor.getByText(text, { exact: true }).click();
  await o.window.waitForTimeout(300);
  for (const key of keys) {
    await o.window.keyboard.press(key);
    await o.window.waitForTimeout(100);
  }
}

/** Presses Ctrl+S once and waits for the file to hold `expected`. */
export async function save(o: Opened, expected: string): Promise<void> {
  await o.window.keyboard.press("Control+S");
  await expect.poll(() => readText(o.path), { timeout: 10000 }).toBe(expected);
}
