// The page: mounts the editor and connects it to the main process through the preload bridge.
import { createEditor } from "@wysidown/editor";
import type {} from "./bridge.ts";

const bridge = window.wysidown;
const editor = createEditor(document.querySelector<HTMLElement>("#editor")!, (message) => {
  bridge.post(message);
});
bridge.onMessage((message) => {
  editor.receive(message);
});

// A file dropped anywhere on the window opens it; the editor never sees the drop.
window.addEventListener(
  "dragover",
  (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  },
  true,
);
window.addEventListener(
  "drop",
  (event) => {
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    bridge.openFile(file);
  },
  true,
);
