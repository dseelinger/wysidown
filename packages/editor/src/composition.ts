import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";

const key = new PluginKey<boolean>("composition");

/**
 * True while a composition is open: from the browser's `compositionstart` until ProseMirror has
 * read the committed text into the document, a moment after `compositionend`.
 */
export function composing(state: EditorState): boolean {
  return key.getState(state) ?? false;
}

/** True when `tr` closes a composition: the document holds its committed text. */
export function endsComposition(tr: Transaction): boolean {
  return tr.getMeta(key) === "end";
}

/**
 * Tracks the open composition. Dispatches a transaction when it starts, and one that
 * `endsComposition` once ProseMirror has read the committed text.
 */
export function composition(): Plugin {
  return new Plugin<boolean>({
    key,
    state: {
      init: () => false,
      apply(tr, open) {
        const meta: unknown = tr.getMeta(key);
        if (meta === "end") return false;
        return open || meta === "start" || tr.getMeta("composition") !== undefined;
      },
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // ProseMirror reads a composition's last text at most 20 milliseconds after the browser ends it.
      const end = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          if (!view.composing && composing(view.state)) view.dispatch(view.state.tr.setMeta(key, "end"));
        }, 20);
      };
      const start = () => {
        clearTimeout(timer);
        timer = undefined;
        if (!composing(view.state)) view.dispatch(view.state.tr.setMeta(key, "start"));
      };
      view.dom.addEventListener("compositionstart", start);
      view.dom.addEventListener("compositionend", end);
      return {
        update() {
          if (!view.composing && timer === undefined && composing(view.state)) end();
        },
        destroy() {
          clearTimeout(timer);
          view.dom.removeEventListener("compositionstart", start);
          view.dom.removeEventListener("compositionend", end);
        },
      };
    },
  });
}
