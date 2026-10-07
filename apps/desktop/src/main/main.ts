import { saveImageRequest, type HostMessage } from "@wysidown/core";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
  type BaseWindow,
  type MenuItem,
  type Session,
  type WebContents,
} from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HostDocument } from "./document.ts";
import { savePastedImage } from "./images.ts";
import { fileScheme, folderOf, linkedAddress, linkedFile, resourcesOf, serveImage, type Folder } from "./resources.ts";
import type { Theme } from "../renderer/theme.ts";
import { defaults, readSettings, writeSettings, type Settings } from "./settings.ts";

const pageUrl = pathToFileURL(join(__dirname, "renderer", "index.html")).href;
const markdownExtensions = ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "txt"];
const markdownFilter = { name: "Markdown", extensions: markdownExtensions };

/** A window and the document it shows. */
interface Editor {
  readonly win: BrowserWindow;
  readonly doc: HostDocument;
  /** The open document's folder; null when it has no file. */
  folder: Folder | null;
  /** True once the user has agreed to close the window. */
  closing: boolean;
  /** True while the window shows the markdown source in place of the rendered document. */
  sourceMode: boolean;
}

const editors = new Set<Editor>();
/** The editor whose window was focused last. */
let lastFocused: Editor | null = null;
let windowCount = 0;
let settings: Settings = { ...defaults };

const settingsPath = (): string => join(app.getPath("userData"), "settings.json");

/** Reads a file as UTF-8, keeping any byte order mark. Throws when the bytes are not valid UTF-8. */
async function readText(path: string): Promise<string> {
  const bytes = await readFile(path);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

function updateTitle(editor: Editor): void {
  const { win, doc } = editor;
  if (win.isDestroyed()) return;
  const name = doc.path === null ? "Untitled" : basename(doc.path);
  win.setTitle(`${doc.dirty ? "● " : ""}${name} — Wysidown`);
}

async function showError(editor: Editor, message: string, detail: string): Promise<void> {
  if (editor.win.isDestroyed()) return;
  await dialog.showMessageBox(editor.win, { type: "error", message, detail, buttons: ["OK"] });
}

/** Opens `path` in the editor. Shows an error and keeps the current document when it cannot be read. */
async function open(editor: Editor, path: string): Promise<void> {
  let text: string;
  try {
    text = await readText(path);
  } catch (error) {
    const detail = error instanceof TypeError ? "The file is not valid UTF-8." : String(error);
    await showError(editor, `Wysidown cannot open ${basename(path)}.`, detail);
    return;
  }
  editor.folder = await folderOf(path);
  editor.doc.load(text, path, resourcesOf(editor.folder, settings.remoteImages));
}

/** Writes the document to `path`. Returns false when the write failed. */
async function saveTo(editor: Editor, path: string): Promise<boolean> {
  const { doc } = editor;
  await doc.flush();
  const text = doc.text;
  try {
    await writeFile(path, text, "utf8");
  } catch (error) {
    await showError(editor, `Wysidown cannot save ${basename(path)}.`, String(error));
    return false;
  }
  const moved = doc.path !== path;
  doc.saved(path, text);
  if (moved) {
    editor.folder = await folderOf(path);
    doc.setResources(resourcesOf(editor.folder, settings.remoteImages));
  }
  return true;
}

async function saveAs(editor: Editor): Promise<boolean> {
  if (editor.win.isDestroyed()) return false;
  const result = await dialog.showSaveDialog(editor.win, {
    defaultPath: editor.doc.path ?? "Untitled.md",
    filters: [markdownFilter],
  });
  if (result.canceled || !result.filePath) return false;
  return saveTo(editor, result.filePath);
}

async function save(editor: Editor): Promise<boolean> {
  return editor.doc.path === null ? saveAs(editor) : saveTo(editor, editor.doc.path);
}

/** Asks whether to save unsaved changes. Resolves true when the document may be replaced or closed. */
async function confirmDiscard(editor: Editor): Promise<boolean> {
  const { win, doc } = editor;
  await doc.flush();
  if (win.isDestroyed() || !doc.dirty) return true;
  const name = doc.path === null ? "Untitled" : basename(doc.path);
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    message: `Save changes to ${name}?`,
    detail: "Your changes will be lost if you don't save them.",
    buttons: ["Save", "Don't Save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (response === 0) return save(editor);
  return response === 1;
}

async function openWithDialog(editor: Editor): Promise<void> {
  if (!(await confirmDiscard(editor)) || editor.win.isDestroyed()) return;
  const result = await dialog.showOpenDialog(editor.win, {
    properties: ["openFile"],
    filters: [markdownFilter, { name: "All files", extensions: ["*"] }],
  });
  const path = result.filePaths[0];
  if (!result.canceled && path !== undefined) await open(editor, path);
}

/** Sends `message` to the editor's page. */
function sendToPage(editor: Editor, message: HostMessage): void {
  const contents = editor.win.webContents;
  if (!contents.isDestroyed()) contents.send("host-message", message);
}

/** Saves a pasted image beside the document and tells the page its path, or tells the user why it was not saved. */
async function savePasted(editor: Editor, id: number, data: string): Promise<void> {
  let path: string | null = null;
  let problem: string | null = null;
  if (!editor.folder) {
    problem = editor.doc.path
      ? "Pasted images are not saved beside a document on a network share."
      : "Save the document first: pasted images are saved in an images folder beside it.";
  } else {
    try {
      path = await savePastedImage(editor.folder.dir, Buffer.from(data, "base64"));
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }
  sendToPage(editor, { type: "imageSaved", id, path });
  if (problem !== null) await showError(editor, "Wysidown cannot paste the image.", problem);
}

/** Opens the markdown file a link in the document leads to. */
async function openLinked(editor: Editor, path: string): Promise<void> {
  if (await confirmDiscard(editor)) await open(editor, path);
}

/** Saves the settings, telling the user of `editor` when they cannot be saved. */
async function saveSettings(editor: Editor): Promise<void> {
  try {
    await writeSettings(settingsPath(), settings);
  } catch (error) {
    await showError(editor, "Wysidown cannot save its settings.", String(error));
  }
}

async function setRemoteImages(editor: Editor, on: boolean): Promise<void> {
  settings = { ...settings, remoteImages: on };
  for (const each of editors) each.doc.setResources(resourcesOf(each.folder, on));
  await saveSettings(editor);
}

/** Shows every window in `theme` and saves it as the setting. */
async function setTheme(editor: Editor, theme: Theme): Promise<void> {
  settings = { ...settings, theme };
  for (const each of editors) {
    const contents = each.win.webContents;
    if (!contents.isDestroyed()) contents.send("theme", theme);
  }
  await saveSettings(editor);
}

/** Opens a file dropped on the window. `path` comes from the renderer, so only absolute markdown paths are taken. */
async function openDropped(editor: Editor, path: unknown): Promise<void> {
  if (typeof path !== "string" || !isAbsolute(path)) return;
  if (!markdownExtensions.includes(extname(path).slice(1).toLowerCase())) return;
  if (await confirmDiscard(editor)) await open(editor, path);
}

/** Shows the markdown source, or the rendered document, in the editor's window. */
function setSourceMode(editor: Editor, on: boolean): void {
  editor.sourceMode = on;
  const contents = editor.win.webContents;
  if (!contents.isDestroyed()) contents.send("source-mode", on);
}

/** The editor a menu click acts on: the one whose window was clicked, else the one focused last. */
function editorFor(window: BaseWindow | undefined): Editor | null {
  for (const editor of editors) if (editor.win === window) return editor;
  return lastFocused;
}

/** A menu click handler that calls `action` with the editor the click acts on and the item's checked state. */
function onEditor(action: (editor: Editor, checked: boolean) => unknown) {
  return (item: MenuItem, window: BaseWindow | undefined): void => {
    const editor = editorFor(window);
    if (editor) void action(editor, item.checked);
  };
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: "&File",
      submenu: [
        { id: "open", label: "&Open…", accelerator: "CmdOrCtrl+O", click: onEditor(openWithDialog) },
        { id: "save", label: "&Save", accelerator: "CmdOrCtrl+S", click: onEditor(save) },
        { id: "save-as", label: "Save &As…", accelerator: "CmdOrCtrl+Shift+S", click: onEditor(saveAs) },
        { type: "separator" },
        {
          label: "E&xit",
          click: onEditor((editor) => {
            editor.win.close();
          }),
        },
      ],
    },
    {
      label: "&Edit",
      submenu: [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" }],
    },
    {
      label: "&View",
      submenu: [
        {
          id: "source-mode",
          label: "&Source Mode",
          type: "checkbox",
          accelerator: "CmdOrCtrl+/",
          checked: false,
          click: onEditor(setSourceMode),
        },
        { type: "separator" },
        {
          id: "remote-images",
          label: "Load &Images from the Web",
          type: "checkbox",
          checked: settings.remoteImages,
          click: onEditor(setRemoteImages),
        },
        {
          label: "&Theme",
          submenu: [
            {
              id: "theme-vscode",
              label: "&VS Code",
              type: "radio",
              checked: settings.theme === "vscode",
              click: onEditor((editor) => setTheme(editor, "vscode")),
            },
            {
              id: "theme-github",
              label: "&GitHub",
              type: "radio",
              checked: settings.theme === "github",
              enabled: false,
              click: onEditor((editor) => setTheme(editor, "github")),
            },
          ],
        },
      ],
    },
  ]);
}

/** Sets the Source Mode check mark to the state of the focused editor. */
function showSourceMode(editor: Editor): void {
  const item = Menu.getApplicationMenu()?.getMenuItemById("source-mode");
  if (item) item.checked = editor.sourceMode;
}

/** The editor whose page sent an IPC message; null when it came from anywhere else. */
function editorOfPage(sender: WebContents, frameUrl: string | undefined): Editor | null {
  if (frameUrl !== pageUrl) return null;
  for (const editor of editors) if (editor.win.webContents === sender) return editor;
  return null;
}

/** The file named on a command line, if any. `argv` is the process's whole argument list. */
function argumentPath(argv: string[]): string | undefined {
  const args = argv.slice(1).filter((a) => !a.startsWith("-"));
  return app.isPackaged ? args[0] : args[1];
}

/**
 * A new session for one window. It grants no permissions, reaches the web only for images, and
 * serves `wysidown-file:` images from the folder of the document `editor` returns.
 */
function windowSession(editor: () => Editor): Session {
  windowCount += 1;
  const own = session.fromPartition(`window-${String(windowCount)}`);
  own.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  // The page reaches the web only for images, and only while they are turned on.
  own.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    callback({ cancel: !(settings.remoteImages && details.resourceType === "image") });
  });
  own.protocol.handle(fileScheme, (request) => serveImage(request.url, editor().folder));
  return own;
}

/** Opens a new window showing the file at `path`, or an untitled document. */
function createWindow(path?: string): void {
  const [x, y] = lastFocused && !lastFocused.win.isDestroyed() ? lastFocused.win.getPosition() : [];
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    ...(x !== undefined && y !== undefined && { x: x + 30, y: y + 30 }),
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
      session: windowSession(() => created),
    },
  });
  const contents = win.webContents;
  const doc = new HostDocument(
    (message) => {
      if (!contents.isDestroyed()) contents.send("host-message", message);
    },
    () => {
      updateTitle(created);
    },
  );
  const created: Editor = { win, doc, folder: null, closing: false, sourceMode: false };
  editors.add(created);
  lastFocused = created;
  doc.setResources(resourcesOf(null, settings.remoteImages));
  updateTitle(created);
  win.on("page-title-updated", (event) => {
    event.preventDefault();
  });
  win.on("focus", () => {
    lastFocused = created;
    showSourceMode(created);
  });
  win.on("close", (event) => {
    if (created.closing) return;
    event.preventDefault();
    void confirmDiscard(created).then((ok) => {
      if (ok) {
        created.closing = true;
        win.close();
      }
    });
  });
  win.on("closed", () => {
    editors.delete(created);
    if (lastFocused === created) lastFocused = [...editors].at(-1) ?? null;
  });
  win.once("ready-to-show", () => {
    win.show();
  });
  void win.loadURL(pageUrl);
  showSourceMode(created);
  if (path !== undefined) void open(created, path);
}

ipcMain.on("editor-message", (event, message: unknown) => {
  const editor = editorOfPage(event.sender, event.senderFrame?.url);
  if (!editor) return;
  const image = saveImageRequest(message);
  if (image !== null) {
    void savePasted(editor, image.id, image.data);
    return;
  }
  const address = linkedAddress(message);
  if (address !== null) {
    shell
      .openExternal(address)
      .catch((error: unknown) => showError(editor, `Wysidown cannot open ${address}.`, String(error)));
    return;
  }
  const linked = linkedFile(message, editor.folder);
  if (linked === null) editor.doc.receive(message);
  else void openLinked(editor, linked);
});

// The page asks for the theme once, before it first draws.
ipcMain.on("theme", (event) => {
  event.returnValue = editorOfPage(event.sender, event.senderFrame?.url) ? settings.theme : null;
});

ipcMain.on("open-file", (event, path: unknown) => {
  const editor = editorOfPage(event.sender, event.senderFrame?.url);
  if (editor) void openDropped(editor, path);
});

// One process per user data folder: a second launch hands its command line to the first and exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv, workingDirectory) => {
    const path = argumentPath(argv);
    void app.whenReady().then(() => {
      createWindow(path === undefined ? undefined : resolve(workingDirectory, path));
    });
  });

  app.enableSandbox();

  protocol.registerSchemesAsPrivileged([{ scheme: fileScheme, privileges: { standard: true, secure: true } }]);

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    settings = await readSettings(settingsPath());
    Menu.setApplicationMenu(buildMenu());
    createWindow(argumentPath(process.argv));
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
