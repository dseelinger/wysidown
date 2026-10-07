import { saveImageRequest, type HostMessage } from "@wysidown/core";
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, type WebContents } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { HostDocument } from "./document.ts";
import { savePastedImage } from "./images.ts";
import { fileScheme, folderOf, linkedAddress, linkedFile, resourcesOf, serveImage, type Folder } from "./resources.ts";
import { readSettings, writeSettings, type Settings } from "./settings.ts";

const pageUrl = pathToFileURL(join(__dirname, "renderer", "index.html")).href;
const markdownExtensions = ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "txt"];
const markdownFilter = { name: "Markdown", extensions: markdownExtensions };

let win: BrowserWindow | null = null;
let doc: HostDocument | null = null;
/** The open document's folder; null when it has no file. */
let folder: Folder | null = null;
let settings: Settings = { remoteImages: true };
let closing = false;

const settingsPath = (): string => join(app.getPath("userData"), "settings.json");

/** Reads a file as UTF-8, keeping any byte order mark. Throws when the bytes are not valid UTF-8. */
async function readText(path: string): Promise<string> {
  const bytes = await readFile(path);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

function updateTitle(): void {
  if (!win || !doc) return;
  const name = doc.path === null ? "Untitled" : basename(doc.path);
  win.setTitle(`${doc.dirty ? "● " : ""}${name} — Wysidown`);
}

async function showError(message: string, detail: string): Promise<void> {
  if (!win) return;
  await dialog.showMessageBox(win, { type: "error", message, detail, buttons: ["OK"] });
}

/** Opens `path` in the window. Shows an error and keeps the current document when it cannot be read. */
async function open(path: string): Promise<void> {
  if (!doc) return;
  let text: string;
  try {
    text = await readText(path);
  } catch (error) {
    const detail = error instanceof TypeError ? "The file is not valid UTF-8." : String(error);
    await showError(`Wysidown cannot open ${basename(path)}.`, detail);
    return;
  }
  folder = await folderOf(path);
  doc.load(text, path, resourcesOf(folder, settings.remoteImages));
}

/** Writes the document to `path`. Returns false when the write failed. */
async function saveTo(path: string): Promise<boolean> {
  if (!doc) return false;
  await doc.flush();
  const text = doc.text;
  try {
    await writeFile(path, text, "utf8");
  } catch (error) {
    await showError(`Wysidown cannot save ${basename(path)}.`, String(error));
    return false;
  }
  const moved = doc.path !== path;
  doc.saved(path, text);
  if (moved) {
    folder = await folderOf(path);
    doc.setResources(resourcesOf(folder, settings.remoteImages));
  }
  return true;
}

async function saveAs(): Promise<boolean> {
  if (!win || !doc) return false;
  const result = await dialog.showSaveDialog(win, {
    defaultPath: doc.path ?? "Untitled.md",
    filters: [markdownFilter],
  });
  if (result.canceled || !result.filePath) return false;
  return saveTo(result.filePath);
}

async function save(): Promise<boolean> {
  if (!doc) return false;
  return doc.path === null ? saveAs() : saveTo(doc.path);
}

/** Asks whether to save unsaved changes. Resolves true when the document may be replaced or closed. */
async function confirmDiscard(): Promise<boolean> {
  await doc?.flush();
  if (!win || !doc?.dirty) return true;
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
  if (response === 0) return save();
  return response === 1;
}

async function openWithDialog(): Promise<void> {
  if (!win || !(await confirmDiscard())) return;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [markdownFilter, { name: "All files", extensions: ["*"] }],
  });
  const path = result.filePaths[0];
  if (!result.canceled && path !== undefined) await open(path);
}

/** Sends `message` to the window's page. */
function sendToPage(message: HostMessage): void {
  const contents = win?.webContents;
  if (contents && !contents.isDestroyed()) contents.send("host-message", message);
}

/** Saves a pasted image beside the document and tells the page its path, or tells the user why it was not saved. */
async function savePasted(id: number, data: string): Promise<void> {
  let path: string | null = null;
  let problem: string | null = null;
  if (!folder) {
    problem = doc?.path
      ? "Pasted images are not saved beside a document on a network share."
      : "Save the document first: pasted images are saved in an images folder beside it.";
  } else {
    try {
      path = await savePastedImage(folder.dir, Buffer.from(data, "base64"));
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }
  sendToPage({ type: "imageSaved", id, path });
  if (problem !== null) await showError("Wysidown cannot paste the image.", problem);
}

/** Opens the markdown file a link in the document leads to. */
async function openLinked(path: string): Promise<void> {
  if (await confirmDiscard()) await open(path);
}

async function setRemoteImages(on: boolean): Promise<void> {
  settings = { ...settings, remoteImages: on };
  doc?.setResources(resourcesOf(folder, on));
  try {
    await writeSettings(settingsPath(), settings);
  } catch (error) {
    await showError("Wysidown cannot save its settings.", String(error));
  }
}

/** Opens a file dropped on the window. `path` comes from the renderer, so only absolute markdown paths are taken. */
async function openDropped(path: unknown): Promise<void> {
  if (typeof path !== "string" || !isAbsolute(path)) return;
  if (!markdownExtensions.includes(extname(path).slice(1).toLowerCase())) return;
  if (await confirmDiscard()) await open(path);
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: "&File",
      submenu: [
        { id: "open", label: "&Open…", accelerator: "CmdOrCtrl+O", click: () => void openWithDialog() },
        { id: "save", label: "&Save", accelerator: "CmdOrCtrl+S", click: () => void save() },
        { id: "save-as", label: "Save &As…", accelerator: "CmdOrCtrl+Shift+S", click: () => void saveAs() },
        { type: "separator" },
        { label: "E&xit", click: () => win?.close() },
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
          id: "remote-images",
          label: "Load &Images from the Web",
          type: "checkbox",
          checked: settings.remoteImages,
          click: (item) => void setRemoteImages(item.checked),
        },
      ],
    },
  ]);
}

/** True when an IPC message came from this window's own page. */
function fromPage(sender: WebContents, frameUrl: string | undefined): boolean {
  return win !== null && sender === win.webContents && frameUrl === pageUrl;
}

/** The file named on the command line, if any. */
function argumentPath(): string | undefined {
  const args = process.argv.slice(1).filter((a) => !a.startsWith("-"));
  return app.isPackaged ? args[0] : args[1];
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1000,
    height: 800,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
    },
  });
  const contents = win.webContents;
  doc = new HostDocument((message) => {
    if (!contents.isDestroyed()) contents.send("host-message", message);
  }, updateTitle);
  doc.setResources(resourcesOf(folder, settings.remoteImages));
  updateTitle();
  win.on("page-title-updated", (event) => {
    event.preventDefault();
  });
  win.on("close", (event) => {
    if (closing || !doc) return;
    event.preventDefault();
    void confirmDiscard().then((ok) => {
      if (ok) {
        closing = true;
        win?.close();
      }
    });
  });
  win.on("closed", () => {
    win = null;
    doc = null;
  });
  win.once("ready-to-show", () => {
    win?.show();
  });
  void win.loadURL(pageUrl);
  const path = argumentPath();
  if (path !== undefined) void open(path);
}

ipcMain.on("editor-message", (event, message: unknown) => {
  if (!fromPage(event.sender, event.senderFrame?.url)) return;
  const image = saveImageRequest(message);
  if (image !== null) {
    void savePasted(image.id, image.data);
    return;
  }
  const address = linkedAddress(message);
  if (address !== null) {
    shell.openExternal(address).catch((error: unknown) => showError(`Wysidown cannot open ${address}.`, String(error)));
    return;
  }
  const linked = linkedFile(message, folder);
  if (linked === null) doc?.receive(message);
  else void openLinked(linked);
});

ipcMain.on("open-file", (event, path: unknown) => {
  if (fromPage(event.sender, event.senderFrame?.url)) void openDropped(path);
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
  // The page reaches the web only for images, and only while they are turned on.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    callback({ cancel: !(settings.remoteImages && details.resourceType === "image") });
  });
  protocol.handle(fileScheme, (request) => serveImage(request.url, folder));
  settings = await readSettings(settingsPath());
  Menu.setApplicationMenu(buildMenu());
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
