// Runs in the sandboxed tab row before its page; the page reaches the main process only through `wysidownTabs`.
import { contextBridge, ipcRenderer } from "electron";
import type { TabRowBridge, TabRowPane } from "./tab-row-bridge.ts";

const bridge: TabRowBridge = {
  onTabs(listener) {
    ipcRenderer.on("tabs", (_event, panes: TabRowPane[]) => {
      listener(panes);
    });
  },
  select(id) {
    ipcRenderer.send("tab-row", "select", id);
  },
  close(id) {
    ipcRenderer.send("tab-row", "close", id);
  },
  newTab(pane) {
    ipcRenderer.send("tab-row", "new", pane);
  },
  focusPane(pane) {
    ipcRenderer.send("tab-row", "focus", pane);
  },
  dragStart() {
    ipcRenderer.send("tab-row", "drag-start");
  },
  drag(x) {
    ipcRenderer.send("tab-row", "drag", x);
  },
  dragEnd() {
    ipcRenderer.send("tab-row", "drag-end");
  },
  equalPanes() {
    ipcRenderer.send("tab-row", "equal");
  },
};

contextBridge.exposeInMainWorld("wysidownTabs", bridge);
