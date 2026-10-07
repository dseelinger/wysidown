// The browser harness: hosts the editor with an in-memory host, for Playwright. `?undo=host` leaves undo to the host;
// `?pane=source` shows the source pane in place of the editor.
import type { EditorMessage, HostMessage } from "@wysidown/core";
import { createEditor, createFindBar, createSourceEditor } from "../src/index.ts";
import type { Harness } from "./api.ts";
import { MemoryHost } from "./memory-host.ts";

const messages: (HostMessage | EditorMessage)[] = [];
let pending = 0;
let waiting: (() => void)[] = [];

/** Delivers messages in order, each after `harness.latency` milliseconds. */
function channel<T extends HostMessage | EditorMessage>(deliver: (message: T) => void): (message: T) => void {
  let tail = Promise.resolve();
  return (message) => {
    messages.push(message);
    pending++;
    tail = tail
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, harness.latency)))
      .then(() => {
        try {
          deliver(message);
        } finally {
          pending--;
          if (pending === 0) {
            for (const resolve of waiting) resolve();
            waiting = [];
          }
        }
      })
      .catch((error: unknown) => {
        reportError(error);
      });
  };
}

const place = document.querySelector<HTMLElement>("#editor")!;
const toEditor = channel<HostMessage>((m) => {
  source?.receive(m);
  editor?.receive(m);
});
const host = new MemoryHost(toEditor);
const toHost = channel<EditorMessage>((m) => {
  host.receive(m);
});
const params = new URLSearchParams(location.search);
const sourcePane = params.get("pane") === "source";
const source = sourcePane ? createSourceEditor(place, toHost) : null;
const editor = sourcePane ? null : createEditor(place, toHost, { history: params.get("undo") !== "host" });
createFindBar(document).attach(source?.find ?? editor?.find ?? null);

const harness: Harness = {
  text: () => host.text,
  version: () => host.version,
  load: (text) => {
    host.load(text);
  },
  change: (text) => {
    host.change(text);
  },
  flush: () => host.flush(),
  resources: (resources) => {
    toEditor({ type: "resources", ...resources });
  },
  selectionInSync: () => {
    if (!editor) return true;
    const { view } = editor;
    const dom = view.dom.ownerDocument.getSelection();
    if (!dom?.focusNode || !view.dom.contains(dom.focusNode)) return false;
    return view.posAtDOM(dom.focusNode, dom.focusOffset) === view.state.selection.head;
  },
  images: () => host.images,
  hasFolder: (on) => {
    host.hasFolder = on;
  },
  latency: 0,
  messages,
  settled: () => (pending === 0 ? Promise.resolve() : new Promise((resolve) => waiting.push(resolve))),
};
window.harness = harness;
