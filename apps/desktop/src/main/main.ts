import { app, BrowserWindow } from "electron";
import { join } from "node:path";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    title: "Wysidown",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => {
    win.show();
  });
  void win.loadFile(join(__dirname, "renderer", "index.html"));
}

void app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
