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
import { PastedImages } from "./pasted-images.ts";
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
  /**
   * False when the host owns undo and redo: the editor keeps no history, leaves their keys to the
   * host, and sends typing a word at a time so that each word is one undo step in the host.
   */
  history?: boolean;
}

/** Milliseconds typing waits for more typing before it is sent, when the host owns undo. */
const typingPause = 1000;

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
  const pastedImages = new PastedImages(post);
  const plugins = [
    ...undoable,
    keymap(tableKeys),
    keymap(codeKeys),
    keymap(listKeys),
    keymap(baseKeymap),
    tables(),
    paste(pastedImages),
    pastedImages.plugin,
    links((href) => {
      post({ type: "open", href });
    }),
  ];
  let resources: Resources = noResources;
  const document = place.ownerDocument;
  const session = new Session(post, plugins, options.history === false ? typingPause : 0);
  const view = new EditorView(place, {
    state: session.state,
    ...views(document, () => resources),
    domParser,
    clipboardSerializer: serializer,
    editable: () => session.loaded,
    dispatchTransaction(tr) {
      const state = view.state.apply(tr);
      view.updateState(state);
      session.update(state, tr);
    },
  });
  // Held typing is sent before a key combination reaches the host and before the page loses the
  // keyboard or is hidden, since a host may destroy the page then. Undo and redo while typing is
  // held are handled here: the host would apply them before the held typing arrives.
  const page = document.defaultView;
  const sendHeld = () => {
    session.sendHeld();
  };
  const sendHeldBeforeCombination = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.altKey && !event.metaKey) return;
    if (["Control", "Alt", "AltGraph", "Meta", "Shift"].includes(event.key)) return;
    const key = event.key.toLowerCase();
    const command = (event.ctrlKey || event.metaKey) && !event.altKey;
    const isUndo = command && key === "z" && !event.shiftKey;
    const isRedo = command && (key === "y" || (key === "z" && event.shiftKey));
    if ((isUndo || isRedo) && session.holding) {
      // Redo after typing has nothing to redo once the typing reaches the host.
      const before = isUndo ? session.undoHeld() : null;
      if (before) view.updateState(before);
      else session.sendHeld();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    session.sendHeld();
  };
  page?.addEventListener("keydown", sendHeldBeforeCombination, true);
  page?.addEventListener("blur", sendHeld);
  page?.addEventListener("pagehide", sendHeld);
  document.addEventListener("visibilitychange", sendHeld);
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
      if (message.type === "imageSaved") {
        pastedImages.receive(message);
        return;
      }
      const state = session.receive(message);
      if (state) props.state = state;
      if (props.state || props.nodeViews) view.setProps(props);
    },
    view,
    destroy() {
      session.sendHeld();
      page?.removeEventListener("keydown", sendHeldBeforeCombination, true);
      page?.removeEventListener("blur", sendHeld);
      page?.removeEventListener("pagehide", sendHeld);
      document.removeEventListener("visibilitychange", sendHeld);
      view.destroy();
    },
  };
}
