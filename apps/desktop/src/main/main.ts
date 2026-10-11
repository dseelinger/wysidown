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
import type { TabRowPane } from "../renderer/tab-row-bridge.ts";
import type { Theme } from "../renderer/theme.ts";
import { defaults, readSettings, writeSettings, type Settings } from "./settings.ts";

const pageUrl = pathToFileURL(join(__dirname, "renderer", "index.html")).href;
const tabRowUrl = pathToFileURL(join(__dirname, "renderer", "tab-row.html")).href;
const tabRowHeight = 35;
/** The width of the splitter between two panes; it matches `#splitter` in tab-row.css. */
const splitterWidth = 4;
const minPaneWidth = 200;
const markdownExtensions = ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "txt"];
const markdownFilter = { name: "Markdown", extensions: markdownExtensions };

/** A document open in a tab, and the view that shows it. */
interface Tab {
  /** Issued by the main process; the tab row names tabs by it. */
  readonly id: number;
  readonly window: EditorWindow;
  /** The pane the tab is in; it changes when the tab is moved to the other pane. */
  pane: Pane;
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

/** One side of a window: its tabs, of which only the active one is shown. */
interface Pane {
  /** In the order its tab row shows them. */
  readonly tabs: Tab[];
  /** Null only while the pane is being created. */
  active: Tab | null;
}

/**
 * A window: one pane, or a left and a right pane, and the page behind them that draws their tab
 * rows and the splitter between them.
 */
interface EditorWindow {
  readonly win: BaseWindow;
  readonly tabRow: WebContentsView;
  /** Left to right; one or two. */
  readonly panes: Pane[];
  /** The pane that menu actions and the tab keys act on. */
  focused: Pane;
  /** The left pane's share of the width the two panes divide. */
  split: number;
  /** True while the splitter is dragged and the tab row page lies above the documents. */
  dragging: boolean;
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

/** The window's tabs, the left pane's first. */
function tabsOf(window: EditorWindow): Tab[] {
  return window.panes.flatMap((p) => p.tabs);
}

function allTabs(): Tab[] {
  return [...windows].flatMap(tabsOf);
}

/** True while the tab is open in its window. */
function isOpen(tab: Tab): boolean {
  return tab.window.panes.includes(tab.pane) && tab.pane.tabs.includes(tab);
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

/** The x and width of each pane, left to right, keeping each at least `minPaneWidth` wide when the window allows it. */
function paneBounds(window: EditorWindow): { x: number; width: number }[] {
  const { width } = window.win.getContentBounds();
  if (window.panes.length < 2) return [{ x: 0, width }];
  const room = Math.max(0, width - splitterWidth);
  const wanted = Math.round(room * window.split);
  const left =
    room < 2 * minPaneWidth ? Math.round(room / 2) : Math.min(Math.max(wanted, minPaneWidth), room - minPaneWidth);
  return [
    { x: 0, width: left },
    { x: left + splitterWidth, width: room - left },
  ];
}

/** Shows the focused pane's active tab's name in the title bar, and every pane's tabs in the tab row. */
function showTabs(window: EditorWindow): void {
  const { win, tabRow, panes, focused } = window;
  if (win.isDestroyed()) return;
  const active = focused.active;
  if (active) win.setTitle(`${active.doc.dirty ? "● " : ""}${documentName(active)} — Wysidown`);
  const bounds = paneBounds(window);
  const state: TabRowPane[] = panes.map((pane, index) => ({
    ...bounds[index]!,
    focused: pane === focused,
    tabs: pane.tabs.map((t) => ({ id: t.id, name: documentName(t), dirty: t.doc.dirty, active: t === pane.active })),
  }));
  if (!tabRow.webContents.isDestroyed()) tabRow.webContents.send("tabs", state);
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
 * Opens `path` in the window's focused pane. A file already open in either pane has its tab shown
 * and its pane focused. Otherwise the file replaces the focused pane's active tab when that is an
 * untitled document with no edits, and opens in a new tab after it when it is not. A file that
 * cannot be read opens nothing.
 */
async function openPath(window: EditorWindow, path: string): Promise<void> {
  const openTab = () => tabsOf(window).find((t) => t.doc.path !== null && samePath(t.doc.path, path));
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
  let tab = window.focused.active;
  if (tab) await tab.doc.flush();
  if (!tab || tab.closing || tab.doc.path !== null || tab.doc.dirty || !isOpen(tab) || tab.pane !== window.focused) {
    tab = addTab(window.focused);
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
  if (window.win.isDestroyed() || !isOpen(tab) || !doc.dirty) return true;
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

/** Spreads the tab row page over the window and places each pane's views below its tab row. */
function layout(window: EditorWindow): void {
  if (window.win.isDestroyed()) return;
  const { width, height } = window.win.getContentBounds();
  window.tabRow.setBounds({ x: 0, y: 0, width, height });
  const bounds = paneBounds(window);
  window.panes.forEach((pane, index) => {
    const { x, width: paneWidth } = bounds[index]!;
    const below = { x, y: tabRowHeight, width: paneWidth, height: Math.max(0, height - tabRowHeight) };
    for (const tab of pane.tabs) tab.view.setBounds(below);
  });
  showTabs(window);
}

/** Makes `pane` the window's focused pane, and shows its active tab in the title bar and the menu. */
function focusPane(window: EditorWindow, pane: Pane): void {
  if (window.focused === pane) return;
  window.focused = pane;
  showTabs(window);
  if (window === lastFocused && pane.active) showSourceMode(pane.active);
}

/** Shows the tab in its pane, hides the pane's others, focuses the pane, and moves the keyboard focus into the tab. */
function activate(tab: Tab): void {
  const { window, pane } = tab;
  if (window.win.isDestroyed() || !isOpen(tab)) return;
  pane.active = tab;
  window.focused = pane;
  for (const each of pane.tabs) each.view.setVisible(each === tab);
  showTabs(window);
  if (window === lastFocused) showSourceMode(tab);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.focus();
}

/** Shows the tab `step` places after the pane's active one, wrapping around at either end. */
function cycle(pane: Pane, step: number): void {
  const { tabs, active } = pane;
  if (!active || tabs.length < 2) return;
  const at = (tabs.indexOf(active) + step + tabs.length) % tabs.length;
  activate(tabs[at]!);
}

/**
 * Moves the pane's active tab, with its page and any unsaved changes, to the end of the other
 * pane, creating the right pane when there is one pane. A pane the move leaves empty is removed,
 * except the only pane, which gets a new untitled tab.
 */
function moveToOtherPane(from: Pane): void {
  const tab = from.active;
  const { window } = tab ?? {};
  if (!tab || !window || window.win.isDestroyed() || !isOpen(tab)) return;
  const splitting = window.panes.length === 1;
  let to = window.panes.find((p) => p !== from);
  if (!to) {
    to = { tabs: [], active: null };
    window.panes.push(to);
  }
  const at = from.tabs.indexOf(tab);
  from.tabs.splice(at, 1);
  to.tabs.push(tab);
  tab.pane = to;
  if (from.tabs.length === 0 && !splitting) {
    window.panes.splice(window.panes.indexOf(from), 1);
  } else {
    from.active = from.tabs[Math.min(at, from.tabs.length - 1)] ?? addTab(from);
    from.active.view.setVisible(true);
  }
  for (const each of to.tabs) each.view.setVisible(each === tab);
  layout(window);
  activate(tab);
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

/** Handles the tab and pane keys, as VS Code has them, pressed in a page of the window; they act on the pane `paneOf` returns. */
function onTabKey(paneOf: () => Pane, event: Event, input: Input): void {
  if (input.type !== "keyDown" || !input.control || input.meta) return;
  const pane = paneOf();
  const key = input.key.toLowerCase();
  if (input.alt) {
    if (input.shift || (key !== "arrowleft" && key !== "arrowright")) return;
    moveToOtherPane(pane);
  } else if (key === "tab") cycle(pane, input.shift ? -1 : 1);
  else if (input.shift) return;
  else if (key === "pagedown") cycle(pane, 1);
  else if (key === "pageup") cycle(pane, -1);
  else if (key === "n") activate(addTab(pane));
  else if (key === "w") {
    if (pane.active) void closeTab(pane.active);
  } else if (key === "\\" || input.code === "Backslash") moveToOtherPane(pane);
  else return;
  event.preventDefault();
}

/** The window that holds `pane`; null once the pane has been removed. */
function windowOfPane(pane: Pane): EditorWindow | null {
  for (const window of windows) if (window.panes.includes(pane)) return window;
  return null;
}

/** Adds an untitled tab to the pane after its active one, hidden until it is activated. */
function addTab(pane: Pane): Tab {
  const window = windowOfPane(pane);
  if (!window) throw new Error("the pane is not in a window");
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
    pane,
    view,
    doc,
    folder: null,
    closing: false,
    sourceMode: false,
    untitled: freeUntitledNumber(),
  };
  doc.setResources(resourcesOf(null, settings.remoteImages));
  const active = pane.active ? pane.tabs.indexOf(pane.active) : -1;
  pane.tabs.splice(active < 0 ? pane.tabs.length : active + 1, 0, tab);
  view.setVisible(false);
  window.win.contentView.addChildView(view);
  layout(window);
  contents.on("before-input-event", (event, input) => {
    onTabKey(() => tab.pane, event, input);
  });
  // Clicking in a page focuses its pane. Loading the page also moves the keyboard focus into it,
  // so that focus is ignored and handed back to the focused pane's tab.
  let navigated = false;
  contents.on("focus", () => {
    if (navigated && isOpen(tab) && tab.pane.active === tab && contents.isFocused()) focusPane(window, tab.pane);
  });
  contents.once("did-navigate", () => {
    navigated = true;
    const active = window.focused.active;
    if (active && active !== tab && !active.view.webContents.isDestroyed()) active.view.webContents.focus();
  });
  void contents.loadURL(pageUrl);
  showTabs(window);
  return tab;
}

/**
 * Removes the tab and its page. Closing the last tab in a pane removes the pane, and the other
 * pane takes the whole window; closing the last tab in the window closes it.
 */
function removeTab(tab: Tab): void {
  const { window, pane } = tab;
  if (!isOpen(tab)) return;
  const at = pane.tabs.indexOf(tab);
  pane.tabs.splice(at, 1);
  if (!window.win.isDestroyed()) window.win.contentView.removeChildView(tab.view);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  if (pane.tabs.length > 0) {
    if (pane.active === tab) activate(pane.tabs[Math.min(at, pane.tabs.length - 1)]!);
    else showTabs(window);
    return;
  }
  window.panes.splice(window.panes.indexOf(pane), 1);
  const other = window.panes[0];
  if (!other?.active) {
    window.closing = true;
    window.win.close();
    return;
  }
  layout(window);
  activate(other.active);
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
  for (const tab of tabsOf(window)) if (!(await confirmDiscard(tab))) return;
  window.closing = true;
  if (!window.win.isDestroyed()) window.win.close();
}

/** The tab a menu click acts on: the focused pane's active tab in the window clicked, else in the window focused last. */
function tabFor(win: BaseWindow | undefined): Tab | null {
  for (const window of windows) if (window.win === win) return window.focused.active;
  return lastFocused?.focused.active ?? null;
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
            activate(addTab(tab.pane));
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
        // The pane keys are handled before the page sees them; the items act when clicked.
        {
          id: "split-right",
          label: "Split &Right",
          accelerator: "CmdOrCtrl+\\",
          registerAccelerator: false,
          click: onTab((tab) => {
            moveToOtherPane(tab.pane);
          }),
        },
        {
          id: "move-to-other-pane",
          label: "&Move Tab to Other Pane",
          accelerator: "CmdOrCtrl+Alt+Right",
          registerAccelerator: false,
          click: onTab((tab) => {
            moveToOtherPane(tab.pane);
          }),
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

/** Raises the tab row page above the documents, so it keeps the pointer while the splitter is dragged. */
function startDrag(window: EditorWindow): void {
  if (window.panes.length < 2 || window.win.isDestroyed()) return;
  window.dragging = true;
  window.win.contentView.addChildView(window.tabRow);
}

/** Moves the splitter so its middle is at `x`, keeping each pane at least `minPaneWidth` wide. */
function dragTo(window: EditorWindow, x: number): void {
  if (!window.dragging || !Number.isFinite(x) || window.win.isDestroyed()) return;
  const room = window.win.getContentBounds().width - splitterWidth;
  if (room < 2 * minPaneWidth) return;
  const left = Math.min(Math.max(Math.round(x - splitterWidth / 2), minPaneWidth), room - minPaneWidth);
  window.split = left / room;
  layout(window);
}

/** Lowers the tab row page behind the documents again. */
function endDrag(window: EditorWindow): void {
  if (!window.dragging) return;
  window.dragging = false;
  if (!window.win.isDestroyed()) window.win.contentView.addChildView(window.tabRow, 0);
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
  const pane: Pane = { tabs: [], active: null };
  const window: EditorWindow = {
    win,
    tabRow,
    panes: [pane],
    focused: pane,
    split: 0.5,
    dragging: false,
    closing: false,
  };
  windows.add(window);
  lastFocused = window;
  // Transparent, so the documents still show while the page is raised above them for a drag.
  tabRow.setBackgroundColor("#00000000");
  win.contentView.addChildView(tabRow);
  tabRow.webContents.on("did-finish-load", () => {
    showTabs(window);
  });
  tabRow.webContents.on("before-input-event", (event, input) => {
    onTabKey(() => window.focused, event, input);
  });
  void tabRow.webContents.loadURL(tabRowUrl);
  const tab = addTab(pane);
  activate(tab);
  tab.view.webContents.once("did-finish-load", () => {
    if (win.isDestroyed()) return;
    win.show();
    const active = window.focused.active;
    if (active && !active.view.webContents.isDestroyed()) active.view.webContents.focus();
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
    if (window.focused.active) showSourceMode(window.focused.active);
  });
  win.on("blur", () => {
    endDrag(window);
  });
  win.on("close", (event) => {
    if (window.closing) return;
    event.preventDefault();
    void closeWindow(window);
  });
  win.on("closed", () => {
    windows.delete(window);
    for (const each of [tabRow, ...tabsOf(window).map((t) => t.view)]) {
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

// The tab row names a tab by the id the main process gave it, and a pane by its place from the
// left; ids from any other window, and panes the window does not have, are ignored.
ipcMain.on("tab-row", (event, action: unknown, arg: unknown) => {
  const window = windowOfTabRow(event.sender, event.senderFrame?.url);
  if (!window) return;
  if (action === "drag-start") startDrag(window);
  else if (action === "drag") {
    if (typeof arg === "number") dragTo(window, arg);
  } else if (action === "drag-end") endDrag(window);
  else if (action === "equal") {
    window.split = 0.5;
    layout(window);
  } else if (action === "new" || action === "focus") {
    const pane = typeof arg === "number" && Number.isInteger(arg) ? window.panes[arg] : undefined;
    if (!pane) return;
    if (action === "new") activate(addTab(pane));
    else if (pane.active) activate(pane.active);
  } else {
    const tab = tabsOf(window).find((t) => t.id === arg);
    if (!tab) return;
    if (action === "select") activate(tab);
    else if (action === "close") void closeTab(tab);
  }
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
      if (path === undefined) activate(addTab(window.focused));
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
