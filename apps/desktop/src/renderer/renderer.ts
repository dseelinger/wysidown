// The page: mounts the editor, or the source pane in source mode, and connects it to the main process through the preload bridge.
// One find bar serves both panes, so its query carries over when the mode changes.
import type { EditorMessage } from "@wysidown/core";
import { createEditor, createFindBar, createSourceEditor, type Editor, type SourceEditor } from "@wysidown/editor";
import type {} from "./bridge.ts";

const bridge = window.wysidown;
const place = document.querySelector<HTMLElement>("#editor")!;

bridge.onTheme((theme) => {
  for (const name of [...document.body.classList]) {
    if (name.startsWith("wysidown-theme-")) document.body.classList.remove(name);
  }
  document.body.classList.add(`wysidown-theme-${theme}`);
  place.classList.toggle("markdown-body", theme === "github");
});

const post = (message: EditorMessage) => {
  bridge.post(message);
};
let pane: Editor | SourceEditor = createEditor(place, post);
let sourceMode = false;
const findBar = createFindBar(document);
findBar.attach(pane.find);

bridge.onFind((replace) => {
  findBar.open(replace);
});

bridge.onMessage((message) => {
  pane.receive(message);
});

// The new pane sends `ready` after every edit of the old one, so the host's `load` holds them all.
bridge.onSourceMode((on) => {
  if (on === sourceMode) return;
  sourceMode = on;
  const selection = pane.sourceSelection();
  pane.destroy();
  const options = { selection, focus: true };
  pane = on ? createSourceEditor(place, post, options) : createEditor(place, post, options);
  findBar.attach(pane.find);
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
