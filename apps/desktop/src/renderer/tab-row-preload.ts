// Runs in the sandboxed tab row before its page; the page reaches the main process only through `wysidownTabs`.
import { contextBridge, ipcRenderer } from "electron";
import type { TabRowBridge, TabRowItem } from "./tab-row-bridge.ts";

const bridge: TabRowBridge = {
  onTabs(listener) {
    ipcRenderer.on("tabs", (_event, tabs: TabRowItem[]) => {
      listener(tabs);
    });
  },
  select(id) {
    ipcRenderer.send("tab-row", "select", id);
  },
  close(id) {
    ipcRenderer.send("tab-row", "close", id);
  },
  newTab() {
    ipcRenderer.send("tab-row", "new");
  },
};

contextBridge.exposeInMainWorld("wysidownTabs", bridge);
