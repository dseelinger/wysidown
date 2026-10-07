// Runs in the sandboxed renderer before the page; the page reaches the main process only through `wysidown`.
import type { HostMessage } from "@wysidown/core";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { Bridge } from "./bridge.ts";
import { isTheme } from "./theme.ts";

const bridge: Bridge = {
  post(message) {
    ipcRenderer.send("editor-message", message);
  },
  onMessage(listener) {
    ipcRenderer.on("host-message", (_event, message: HostMessage) => {
      listener(message);
    });
  },
  openFile(file) {
    const path = webUtils.getPathForFile(file);
    if (path) ipcRenderer.send("open-file", path);
  },
  onSourceMode(listener) {
    ipcRenderer.on("source-mode", (_event, on: unknown) => {
      listener(on === true);
    });
  },
  onFind(listener) {
    ipcRenderer.on("find", (_event, replace: unknown) => {
      listener(replace === true);
    });
  },
  onTheme(listener) {
    const current: unknown = ipcRenderer.sendSync("theme");
    if (isTheme(current)) listener(current);
    ipcRenderer.on("theme", (_event, theme: unknown) => {
      if (isTheme(theme)) listener(theme);
    });
  },
};

contextBridge.exposeInMainWorld("wysidown", bridge);
