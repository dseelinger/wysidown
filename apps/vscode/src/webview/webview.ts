// The webview page: mounts the editor and connects it to the extension. VS Code owns undo, so the editor keeps no history.
import type { EditorMessage, HostMessage } from "@wysidown/core";
import { createEditor, createFindBar } from "@wysidown/editor";

declare function acquireVsCodeApi(): { postMessage(message: EditorMessage): void };

const host = acquireVsCodeApi();
const editor = createEditor(
  document.querySelector<HTMLElement>("#editor")!,
  (message) => {
    host.postMessage(message);
  },
  { history: false },
);
createFindBar(document).attach(editor.find);
window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  editor.receive(event.data);
});
