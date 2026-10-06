import type { EditorMessage, HostMessage, Resources } from "@wysidown/core";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorView, type DirectEditorProps } from "prosemirror-view";
import { codeKeys } from "./code.ts";
import { noResources } from "./images.ts";
import { links } from "./links.ts";
import { listKeys } from "./lists.ts";
import { paste } from "./paste.ts";
import { domParser, serializer, views } from "./render.ts";
import { Session } from "./session.ts";
import { tableKeys, tables } from "./tables.ts";

export interface Editor {
  /** Passes a message from the host to the editor. */
  receive(message: HostMessage): void;
  readonly view: EditorView;
  destroy(): void;
}

export interface EditorOptions {
  /** False when the host owns undo and redo: the editor keeps no history and leaves their keys to the host. */
  history?: boolean;
}

/**
 * Mounts the editor in `place` and sends `ready`. The host answers with `load`, and passes every
 * later message to `receive`. The editor reaches the host only through `post`.
 */
export function createEditor(
  place: HTMLElement,
  post: (message: EditorMessage) => void,
  options: EditorOptions = {},
): Editor {
  const undoable =
    options.history === false ? [] : [history(), keymap({ "Mod-z": undo, "Mod-y": redo, "Shift-Mod-z": redo })];
  const plugins = [
    ...undoable,
    keymap(tableKeys),
    keymap(codeKeys),
    keymap(listKeys),
    keymap(baseKeymap),
    tables(),
    paste(),
    links((href) => {
      post({ type: "open", href });
    }),
  ];
  let resources: Resources = noResources;
  const document = place.ownerDocument;
  const session = new Session(post, plugins);
  const view = new EditorView(place, {
    state: session.state,
    ...views(document, () => resources),
    domParser,
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
      // New resources and a new document are drawn together, so the old document's images are not
      // requested from the new folder.
      const props: Partial<DirectEditorProps> = {};
      const next = message.type === "resources" ? message : message.type === "load" ? message.resources : undefined;
      if (
        next &&
        (next.base !== resources.base || next.root !== resources.root || next.remoteImages !== resources.remoteImages)
      ) {
        resources = { base: next.base, root: next.root, remoteImages: next.remoteImages };
        props.nodeViews = views(document, () => resources).nodeViews;
      }
      const state = session.receive(message);
      if (state) props.state = state;
      if (props.state || props.nodeViews) view.setProps(props);
    },
    view,
    destroy() {
      view.destroy();
    },
  };
}
