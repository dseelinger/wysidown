// Runs in the sandboxed renderer before the page; the page reaches the main process only through `wysidown`.
import type { HostMessage } from "@wysidown/core";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { Bridge } from "./bridge.ts";

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
};

contextBridge.exposeInMainWorld("wysidown", bridge);
