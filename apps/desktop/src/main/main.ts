import { saveImageRequest, type HostMessage } from "@wysidown/core";
import {
  app,
  BaseWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
  WebContentsView,
  type Event,
  type Input,
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
import type { TabRowItem } from "../renderer/tab-row-bridge.ts";
import type { Theme } from "../renderer/theme.ts";
import { defaults, readSettings, writeSettings, type Settings } from "./settings.ts";

const pageUrl = pathToFileURL(join(__dirname, "renderer", "index.html")).href;
const tabRowUrl = pathToFileURL(join(__dirname, "renderer", "tab-row.html")).href;
const tabRowHeight = 35;
const markdownExtensions = ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "txt"];
const markdownFilter = { name: "Markdown", extensions: markdownExtensions };

/** A document open in a tab, and the view that shows it. */
interface Tab {
  /** Issued by the main process; the tab row names tabs by it. */
  readonly id: number;
  readonly window: EditorWindow;
  readonly view: WebContentsView;
  readonly doc: HostDocument;
  /** The open document's folder; null when it has no file. */
  folder: Folder | null;
  /** True once the user has agreed to close the tab. */
  closing: boolean;
  /** True while the tab shows the markdown source in place of the rendered document. */
  sourceMode: boolean;
  /** The number in the document's name while it has no file: 1 for `Untitled.md`, 2 for `Untitled-2.md`. */
  readonly untitled: number;
}

/** A window: the tab row across its top, and its tabs, of which only the active one is shown. */
interface EditorWindow {
  readonly win: BaseWindow;
  readonly tabRow: WebContentsView;
  /** In the order the tab row shows them. */
  readonly tabs: Tab[];
  /** Null only while the window is being created. */
  active: Tab | null;
  /** True once the user has agreed to close the window. */
  closing: boolean;
}

const windows = new Set<EditorWindow>();
/** The window focused last. */
let lastFocused: EditorWindow | null = null;
let lastTabId = 0;
let sessionCount = 0;
let tabRowSession: Session | null = null;
let settings: Settings = { ...defaults };

const settingsPath = (): string => join(app.getPath("userData"), "settings.json");

function allTabs(): Tab[] {
  return [...windows].flatMap((w) => w.tabs);
}

/** Reads a file as UTF-8, keeping any byte order mark. Throws when the bytes are not valid UTF-8. */
async function readText(path: string): Promise<string> {
  const bytes = await readFile(path);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

/** The lowest untitled number no document without a file is using. */
function freeUntitledNumber(): number {
  const used = new Set(
    allTabs()
      .filter((t) => t.doc.path === null)
      .map((t) => t.untitled),
  );
  let number = 1;
  while (used.has(number)) number++;
  return number;
}

/** The document's name: its file's name, or `Untitled.md`, `Untitled-2.md` and so on when it has no file. */
function documentName(tab: Tab): string {
  const { doc, untitled } = tab;
  if (doc.path !== null) return basename(doc.path);
  return untitled === 1 ? "Untitled.md" : `Untitled-${String(untitled)}.md`;
}

/** True when `a` and `b` name the same file. */
function samePath(a: string, b: string): boolean {
  const key = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
  return key(a) === key(b);
}

/** Shows the active tab's name in the title bar, and every tab in the tab row. */
function showTabs(window: EditorWindow): void {
  const { win, tabRow, tabs, active } = window;
  if (win.isDestroyed()) return;
  if (active) win.setTitle(`${active.doc.dirty ? "● " : ""}${documentName(active)} — Wysidown`);
  const items: TabRowItem[] = tabs.map((t) => ({
    id: t.id,
    name: documentName(t),
    dirty: t.doc.dirty,
    active: t === active,
  }));
  if (!tabRow.webContents.isDestroyed()) tabRow.webContents.send("tabs", items);
}

async function showError(window: EditorWindow, message: string, detail: string): Promise<void> {
  if (window.win.isDestroyed()) return;
  await dialog.showMessageBox(window.win, { type: "error", message, detail, buttons: ["OK"] });
}

/** The text of the file at `path`; null, after telling the user why, when it cannot be read. */
async function readDocument(window: EditorWindow, path: string): Promise<string | null> {
  try {
    return await readText(path);
  } catch (error) {
    const detail = error instanceof TypeError ? "The file is not valid UTF-8." : String(error);
    await showError(window, `Wysidown cannot open ${basename(path)}.`, detail);
    return null;
  }
}

/** Shows `text`, read from `path`, in the tab. */
async function load(tab: Tab, path: string, text: string): Promise<void> {
  tab.folder = await folderOf(path);
  tab.doc.load(text, path, resourcesOf(tab.folder, settings.remoteImages));
}

/**
 * Opens `path` in the window. A file already open there has its tab shown. Otherwise the file
 * replaces the active tab when that is an untitled document with no edits, and opens in a new tab
 * after the active one when it is not. A file that cannot be read opens nothing.
 */
async function openPath(window: EditorWindow, path: string): Promise<void> {
  const openTab = () => window.tabs.find((t) => t.doc.path !== null && samePath(t.doc.path, path));
  const already = openTab();
  if (already) {
    activate(already);
    return;
  }
  const text = await readDocument(window, path);
  if (text === null || window.win.isDestroyed()) return;
  const opened = openTab();
  if (opened) {
    activate(opened);
    return;
  }
  let tab = window.active;
  if (tab) await tab.doc.flush();
  if (!tab || tab.closing || tab.doc.path !== null || tab.doc.dirty || !window.tabs.includes(tab)) {
    tab = addTab(window);
  }
  await load(tab, path, text);
  activate(tab);
}

/** Writes the document to `path`. Returns false when the write failed. */
async function saveTo(tab: Tab, path: string): Promise<boolean> {
  const { doc } = tab;
  await doc.flush();
  const text = doc.text;
  try {
    await writeFile(path, text, "utf8");
  } catch (error) {
    await showError(tab.window, `Wysidown cannot save ${basename(path)}.`, String(error));
    return false;
  }
  const moved = doc.path !== path;
  doc.saved(path, text);
  if (moved) {
    tab.folder = await folderOf(path);
    doc.setResources(resourcesOf(tab.folder, settings.remoteImages));
  }
  return true;
}

async function saveAs(tab: Tab): Promise<boolean> {
  const { win } = tab.window;
  if (win.isDestroyed()) return false;
  const result = await dialog.showSaveDialog(win, {
    defaultPath: tab.doc.path ?? documentName(tab),
    filters: [markdownFilter],
  });
  if (result.canceled || !result.filePath) return false;
  return saveTo(tab, result.filePath);
}

async function save(tab: Tab): Promise<boolean> {
  return tab.doc.path === null ? saveAs(tab) : saveTo(tab, tab.doc.path);
}

/**
 * Asks whether to save the tab's unsaved changes, showing the tab first. Resolves true when the
 * document may be closed.
 */
async function confirmDiscard(tab: Tab): Promise<boolean> {
  const { doc, window } = tab;
  await doc.flush();
  if (window.win.isDestroyed() || !window.tabs.includes(tab) || !doc.dirty) return true;
  activate(tab);
  const { response } = await dialog.showMessageBox(window.win, {
    type: "warning",
    message: `Save changes to ${documentName(tab)}?`,
    detail: "Your changes will be lost if you don't save them.",
    buttons: ["Save", "Don't Save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (response === 0) return save(tab);
  return response === 1;
}

async function openWithDialog(tab: Tab): Promise<void> {
  const { window } = tab;
  if (window.win.isDestroyed()) return;
  const result = await dialog.showOpenDialog(window.win, {
    properties: ["openFile"],
    filters: [markdownFilter, { name: "All files", extensions: ["*"] }],
  });
  const path = result.filePaths[0];
  if (!result.canceled && path !== undefined) await openPath(window, path);
}

/** Sends `channel` and its arguments to the tab's page. */
function sendToPage(tab: Tab, channel: string, ...args: unknown[]): void {
  const contents = tab.view.webContents;
  if (!contents.isDestroyed()) contents.send(channel, ...args);
}

/** Saves a pasted image beside the document and tells the page its path, or tells the user why it was not saved. */
async function savePasted(tab: Tab, id: number, data: string): Promise<void> {
  let path: string | null = null;
  let problem: string | null = null;
  if (!tab.folder) {
    problem = tab.doc.path
      ? "Pasted images are not saved beside a document on a network share."
      : "Save the document first: pasted images are saved in an images folder beside it.";
  } else {
    try {
      path = await savePastedImage(tab.folder.dir, Buffer.from(data, "base64"));
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }
  const message: HostMessage = { type: "imageSaved", id, path };
  sendToPage(tab, "host-message", message);
  if (problem !== null) await showError(tab.window, "Wysidown cannot paste the image.", problem);
}

/** Saves the settings, telling the user of `window` when they cannot be saved. */
async function saveSettings(window: EditorWindow): Promise<void> {
  try {
    await writeSettings(settingsPath(), settings);
  } catch (error) {
    await showError(window, "Wysidown cannot save its settings.", String(error));
  }
}

async function setRemoteImages(tab: Tab, on: boolean): Promise<void> {
  settings = { ...settings, remoteImages: on };
  for (const each of allTabs()) each.doc.setResources(resourcesOf(each.folder, on));
  await saveSettings(tab.window);
}

/** Shows every tab in `theme` and saves it as the setting. */
async function setTheme(tab: Tab, theme: Theme): Promise<void> {
  settings = { ...settings, theme };
  for (const each of allTabs()) sendToPage(each, "theme", theme);
  await saveSettings(tab.window);
}

/** Opens a file dropped on the tab's page. `path` comes from the renderer, so only absolute markdown paths are taken. */
async function openDropped(tab: Tab, path: unknown): Promise<void> {
  if (typeof path !== "string" || !isAbsolute(path)) return;
  if (!markdownExtensions.includes(extname(path).slice(1).toLowerCase())) return;
  await openPath(tab.window, path);
}

/** Shows the markdown source, or the rendered document, in the tab. */
function setSourceMode(tab: Tab, on: boolean): void {
  tab.sourceMode = on;
  sendToPage(tab, "source-mode", on);
}

/** Opens the find bar in the tab, with the replace row when `replace` is true. */
function showFind(tab: Tab, replace: boolean): void {
  sendToPage(tab, "find", replace);
}

/** Sets the Source Mode check mark to the state of `tab`. */
function showSourceMode(tab: Tab): void {
  const item = Menu.getApplicationMenu()?.getMenuItemById("source-mode");
  if (item) item.checked = tab.sourceMode;
}

/** Places the tab row across the top of the window and the tabs' views below it. */
function layout(window: EditorWindow): void {
  if (window.win.isDestroyed()) return;
  const { width, height } = window.win.getContentBounds();
  window.tabRow.setBounds({ x: 0, y: 0, width, height: tabRowHeight });
  const below = { x: 0, y: tabRowHeight, width, height: Math.max(0, height - tabRowHeight) };
  for (const tab of window.tabs) tab.view.setBounds(below);
}

/** Shows the tab in its window, hides the others, and moves the keyboard focus into it. */
function activate(tab: Tab): void {
  const { window } = tab;
  if (window.win.isDestroyed() || !window.tabs.includes(tab)) return;
  window.active = tab;
  for (const each of window.tabs) each.view.setVisible(each === tab);
  showTabs(window);
  if (window === lastFocused) showSourceMode(tab);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.focus();
}

/** Shows the tab `step` places after the active one, wrapping around at either end. */
function cycle(window: EditorWindow, step: number): void {
  const { tabs, active } = window;
  if (!active || tabs.length < 2) return;
  const at = (tabs.indexOf(active) + step + tabs.length) % tabs.length;
  activate(tabs[at]!);
}

/**
 * A new session for one tab. It grants no permissions, reaches the web only for images, and
 * serves `wysidown-file:` images from the folder of the document `tab` returns.
 */
function tabSession(tab: () => Tab): Session {
  sessionCount += 1;
  const own = session.fromPartition(`tab-${String(sessionCount)}`);
  own.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  // The page reaches the web only for images, and only while they are turned on.
  own.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    callback({ cancel: !(settings.remoteImages && details.resourceType === "image") });
  });
  own.protocol.handle(fileScheme, (request) => serveImage(request.url, tab().folder));
  return own;
}

/** The session every tab row shares. It grants no permissions and never reaches the web. */
function tabRowSessionOnce(): Session {
  if (tabRowSession) return tabRowSession;
  const own = session.fromPartition("tab-row");
  own.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  own.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => {
    callback({ cancel: true });
  });
  tabRowSession = own;
  return own;
}

/** Handles the tab keys, as VS Code has them, pressed in any page of the window. */
function onTabKey(window: EditorWindow, event: Event, input: Input): void {
  if (input.type !== "keyDown" || !input.control || input.alt || input.meta) return;
  const key = input.key.toLowerCase();
  if (key === "tab") cycle(window, input.shift ? -1 : 1);
  else if (input.shift) return;
  else if (key === "pagedown") cycle(window, 1);
  else if (key === "pageup") cycle(window, -1);
  else if (key === "n") activate(addTab(window));
  else if (key === "w") {
    if (window.active) void closeTab(window.active);
  } else return;
  event.preventDefault();
}

/** Adds an untitled tab after the active one, hidden until it is activated. */
function addTab(window: EditorWindow): Tab {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
      session: tabSession(() => tab),
    },
  });
  const contents = view.webContents;
  const doc = new HostDocument(
    (message) => {
      if (!contents.isDestroyed()) contents.send("host-message", message);
    },
    () => {
      showTabs(window);
    },
  );
  const tab: Tab = {
    id: ++lastTabId,
    window,
    view,
    doc,
    folder: null,
    closing: false,
    sourceMode: false,
    untitled: freeUntitledNumber(),
  };
  doc.setResources(resourcesOf(null, settings.remoteImages));
  const at = window.active ? window.tabs.indexOf(window.active) + 1 : window.tabs.length;
  window.tabs.splice(at, 0, tab);
  view.setVisible(false);
  window.win.contentView.addChildView(view);
  layout(window);
  contents.on("before-input-event", (event, input) => {
    onTabKey(window, event, input);
  });
  void contents.loadURL(pageUrl);
  showTabs(window);
  return tab;
}

/** Removes the tab and its page. Closing the last tab closes the window. */
function removeTab(tab: Tab): void {
  const { window } = tab;
  const at = window.tabs.indexOf(tab);
  if (at < 0) return;
  window.tabs.splice(at, 1);
  if (!window.win.isDestroyed()) window.win.contentView.removeChildView(tab.view);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  if (window.tabs.length === 0) {
    window.closing = true;
    window.win.close();
    return;
  }
  if (window.active === tab) activate(window.tabs[Math.min(at, window.tabs.length - 1)]!);
  else showTabs(window);
}

/** Closes the tab, asking first when it has unsaved changes. */
async function closeTab(tab: Tab): Promise<void> {
  if (tab.closing) return;
  tab.closing = true;
  if (await confirmDiscard(tab)) removeTab(tab);
  else tab.closing = false;
}

/** Closes the window once every tab with unsaved changes has been saved or discarded; Cancel on any keeps them all. */
async function closeWindow(window: EditorWindow): Promise<void> {
  for (const tab of [...window.tabs]) if (!(await confirmDiscard(tab))) return;
  window.closing = true;
  if (!window.win.isDestroyed()) window.win.close();
}

/** The tab a menu click acts on: the active tab of the window clicked, else of the window focused last. */
function tabFor(win: BaseWindow | undefined): Tab | null {
  for (const window of windows) if (window.win === win) return window.active;
  return lastFocused?.active ?? null;
}

/** A menu click handler that calls `action` with the tab the click acts on and the item's checked state. */
function onTab(action: (tab: Tab, checked: boolean) => unknown) {
  return (item: MenuItem, win: BaseWindow | undefined): void => {
    const tab = tabFor(win);
    if (tab) void action(tab, item.checked);
  };
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: "&File",
      submenu: [
        // The tab keys are handled before the page sees them; the items act when clicked.
        {
          id: "new",
          label: "&New",
          accelerator: "CmdOrCtrl+N",
          registerAccelerator: false,
          click: onTab((tab) => {
            activate(addTab(tab.window));
          }),
        },
        { id: "open", label: "&Open…", accelerator: "CmdOrCtrl+O", click: onTab(openWithDialog) },
        { id: "save", label: "&Save", accelerator: "CmdOrCtrl+S", click: onTab(save) },
        { id: "save-as", label: "Save &As…", accelerator: "CmdOrCtrl+Shift+S", click: onTab(saveAs) },
        { type: "separator" },
        {
          id: "close-tab",
          label: "&Close Tab",
          accelerator: "CmdOrCtrl+W",
          registerAccelerator: false,
          click: onTab(closeTab),
        },
        {
          label: "E&xit",
          click: onTab((tab) => {
            tab.window.win.close();
          }),
        },
      ],
    },
    {
      label: "&Edit",
      submenu: [
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        { role: "selectAll" },
        { type: "separator" },
        // The page handles the keys itself; the items open the bar when clicked.
        {
          id: "find",
          label: "&Find",
          accelerator: "CmdOrCtrl+F",
          registerAccelerator: false,
          click: onTab((tab) => {
            showFind(tab, false);
          }),
        },
        {
          id: "replace",
          label: "&Replace",
          accelerator: "CmdOrCtrl+H",
          registerAccelerator: false,
          click: onTab((tab) => {
            showFind(tab, true);
          }),
        },
      ],
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
          click: onTab(setSourceMode),
        },
        { type: "separator" },
        {
          id: "remote-images",
          label: "Load &Images from the Web",
          type: "checkbox",
          checked: settings.remoteImages,
          click: onTab(setRemoteImages),
        },
        {
          label: "&Theme",
          submenu: [
            {
              id: "theme-vscode",
              label: "&VS Code",
              type: "radio",
              checked: settings.theme === "vscode",
              click: onTab((tab) => setTheme(tab, "vscode")),
            },
            {
              id: "theme-github",
              label: "&GitHub",
              type: "radio",
              checked: settings.theme === "github",
              click: onTab((tab) => setTheme(tab, "github")),
            },
          ],
        },
      ],
    },
  ]);
}

/** The tab whose page sent an IPC message; null when it came from anywhere else. */
function tabOfPage(sender: WebContents, frameUrl: string | undefined): Tab | null {
  if (frameUrl !== pageUrl) return null;
  return allTabs().find((t) => t.view.webContents === sender) ?? null;
}

/** The window whose tab row sent an IPC message; null when it came from anywhere else. */
function windowOfTabRow(sender: WebContents, frameUrl: string | undefined): EditorWindow | null {
  if (frameUrl !== tabRowUrl) return null;
  for (const window of windows) if (window.tabRow.webContents === sender) return window;
  return null;
}

/** The file named on a command line, if any. `argv` is the process's whole argument list. */
function argumentPath(argv: string[]): string | undefined {
  const args = argv.slice(1).filter((a) => !a.startsWith("-"));
  return app.isPackaged ? args[0] : args[1];
}

/** Opens a new window with one tab showing the file at `path`, or an untitled document. */
function createWindow(path?: string): void {
  const [x, y] = lastFocused && !lastFocused.win.isDestroyed() ? lastFocused.win.getPosition() : [];
  const win = new BaseWindow({
    width: 1000,
    height: 800,
    ...(x !== undefined && y !== undefined && { x: x + 30, y: y + 30 }),
    show: false,
  });
  const tabRow = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(__dirname, "tab-row-preload.cjs"),
      session: tabRowSessionOnce(),
    },
  });
  const window: EditorWindow = { win, tabRow, tabs: [], active: null, closing: false };
  windows.add(window);
  lastFocused = window;
  win.contentView.addChildView(tabRow);
  tabRow.webContents.on("did-finish-load", () => {
    showTabs(window);
  });
  tabRow.webContents.on("before-input-event", (event, input) => {
    onTabKey(window, event, input);
  });
  void tabRow.webContents.loadURL(tabRowUrl);
  const tab = addTab(window);
  activate(tab);
  tab.view.webContents.once("did-finish-load", () => {
    if (win.isDestroyed()) return;
    win.show();
    if (window.active && !window.active.view.webContents.isDestroyed()) window.active.view.webContents.focus();
  });
  const relayout = (): void => {
    layout(window);
  };
  win.on("resize", relayout);
  win.on("maximize", relayout);
  win.on("unmaximize", relayout);
  win.on("restore", relayout);
  win.on("focus", () => {
    lastFocused = window;
    if (window.active) showSourceMode(window.active);
  });
  win.on("close", (event) => {
    if (window.closing) return;
    event.preventDefault();
    void closeWindow(window);
  });
  win.on("closed", () => {
    windows.delete(window);
    for (const each of [tabRow, ...window.tabs.map((t) => t.view)]) {
      if (!each.webContents.isDestroyed()) each.webContents.close();
    }
    if (lastFocused === window) lastFocused = [...windows].at(-1) ?? null;
  });
  if (path !== undefined) {
    void readDocument(window, path).then((text) => (text === null ? undefined : load(tab, path, text)));
  }
}

ipcMain.on("editor-message", (event, message: unknown) => {
  const tab = tabOfPage(event.sender, event.senderFrame?.url);
  if (!tab) return;
  const image = saveImageRequest(message);
  if (image !== null) {
    void savePasted(tab, image.id, image.data);
    return;
  }
  const address = linkedAddress(message);
  if (address !== null) {
    shell
      .openExternal(address)
      .catch((error: unknown) => showError(tab.window, `Wysidown cannot open ${address}.`, String(error)));
    return;
  }
  const linked = linkedFile(message, tab.folder);
  if (linked === null) tab.doc.receive(message);
  else void openPath(tab.window, linked);
});

// The page asks for the theme once, before it first draws.
ipcMain.on("theme", (event) => {
  event.returnValue = tabOfPage(event.sender, event.senderFrame?.url) ? settings.theme : null;
});

ipcMain.on("open-file", (event, path: unknown) => {
  const tab = tabOfPage(event.sender, event.senderFrame?.url);
  if (tab) void openDropped(tab, path);
});

// The tab row names a tab by the id the main process gave it; ids from any other window are ignored.
ipcMain.on("tab-row", (event, action: unknown, id: unknown) => {
  const window = windowOfTabRow(event.sender, event.senderFrame?.url);
  if (!window) return;
  if (action === "new") {
    activate(addTab(window));
    return;
  }
  const tab = window.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (action === "select") activate(tab);
  else if (action === "close") void closeTab(tab);
});

// One process per user data folder: a second launch hands its command line to the first and exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch opens its file, or an untitled document, in a new tab of the window focused last.
  app.on("second-instance", (_event, argv, workingDirectory) => {
    const named = argumentPath(argv);
    const path = named === undefined ? undefined : resolve(workingDirectory, named);
    void app.whenReady().then(() => {
      const window = lastFocused;
      if (!window || window.win.isDestroyed()) {
        createWindow(path);
        return;
      }
      if (window.win.isMinimized()) window.win.restore();
      window.win.focus();
      if (path === undefined) activate(addTab(window));
      else void openPath(window, path);
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
