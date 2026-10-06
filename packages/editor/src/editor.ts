import type { EditorMessage, HostMessage } from "@wysidown/core";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorView } from "prosemirror-view";
import { clipboardParser, domParser, serializer, views } from "./render.ts";
import { Session } from "./session.ts";

export interface Editor {
  /** Passes a message from the host to the editor. */
  receive(message: HostMessage): void;
  readonly view: EditorView;
  destroy(): void;
}

/**
 * Mounts the editor in `place` and sends `ready`. The host answers with `load`, and passes every
 * later message to `receive`. The editor reaches the host only through `post`.
 */
export function createEditor(place: HTMLElement, post: (message: EditorMessage) => void): Editor {
  const plugins = [history(), keymap({ "Mod-z": undo, "Mod-y": redo, "Shift-Mod-z": redo }), keymap(baseKeymap)];
  const session = new Session(post, plugins);
  const view = new EditorView(place, {
    state: session.state,
    ...views(place.ownerDocument),
    domParser,
    clipboardParser,
    clipboardSerializer: serializer,
    editable: () => session.loaded,
    dispatchTransaction(tr) {
      const state = view.state.apply(tr);
      view.updateState(state);
      session.update(state);
    },
  });
  post({ type: "ready" });
  return {
    receive(message) {
      const state = session.receive(message);
      if (state) view.updateState(state);
    },
    view,
    destroy() {
      view.destroy();
    },
  };
}
