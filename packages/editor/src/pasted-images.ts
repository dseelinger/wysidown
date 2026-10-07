import { schema, type EditorMessage, type HostMessage } from "@wysidown/core";
import { Fragment, Slice, type Node } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/** A paste whose images are being saved: its content, with each image's `src` a token until its path is known. */
interface Paste {
  slice: Slice;
  /** The saved path of each token's image; null when it was not saved. */
  paths: Map<string, string | null>;
  /** Images the host has not answered for yet. */
  left: number;
}

/** The range each waiting paste replaces, keyed by paste, mapped through every change since. */
type Ranges = ReadonlyMap<number, { from: number; to: number }>;

type RangeMeta = { add: number; from: number; to: number } | { remove: number };

const rangesKey = new PluginKey<Ranges>("pastedImages");

/** Clipboard content whose images must be saved before it is pasted. */
export interface ClipboardImages {
  /** The content, with each image to save having a token as its `src`. */
  slice: Slice;
  /** The base64 bytes of each token's image; null when it cannot be read. */
  sources: Map<string, Promise<string | null>>;
}

/**
 * Pastes content holding images that are only on the clipboard. Each image is sent to the host as
 * `saveImage`, and the content is pasted once the host has answered for all of them, with the saved
 * paths, where the paste was made. Images the host did not save are left out.
 */
export class PastedImages {
  readonly #post: (message: EditorMessage) => void;
  #view: EditorView | null = null;
  #lastPaste = 0;
  #lastImage = 0;
  readonly #pastes = new Map<number, Paste>();
  /** The paste and token of each image sent to the host. */
  readonly #images = new Map<number, { paste: number; token: string }>();

  constructor(post: (message: EditorMessage) => void) {
    this.#post = post;
  }

  /** Records where each waiting paste goes. */
  readonly plugin = new Plugin<Ranges>({
    key: rangesKey,
    state: {
      init: () => new Map(),
      apply(tr, ranges) {
        const meta = tr.getMeta(rangesKey) as RangeMeta | undefined;
        if (!meta && !tr.docChanged) return ranges;
        const next = new Map<number, { from: number; to: number }>();
        for (const [paste, range] of ranges) {
          const from = tr.mapping.map(range.from, 1);
          next.set(paste, { from, to: Math.max(from, tr.mapping.map(range.to, -1)) });
        }
        if (meta && "add" in meta) next.set(meta.add, { from: meta.from, to: meta.to });
        if (meta && "remove" in meta) next.delete(meta.remove);
        return next;
      },
    },
    view: (view) => {
      this.#view = view;
      return {
        destroy: () => {
          this.#view = null;
        },
      };
    },
  });

  /** Starts pasting `images` over the selection. */
  paste(view: EditorView, images: ClipboardImages): void {
    const paste = ++this.#lastPaste;
    const { from, to } = view.state.selection;
    view.dispatch(view.state.tr.setMeta(rangesKey, { add: paste, from, to } satisfies RangeMeta));
    const sources = Array.from(images.sources, async ([token, data]) => [token, await data] as const);
    void Promise.all(sources).then((read) => {
      const waiting: Paste = { slice: images.slice, paths: new Map(), left: 0 };
      this.#pastes.set(paste, waiting);
      for (const [token, data] of read) {
        if (data === null) {
          waiting.paths.set(token, null);
          continue;
        }
        const id = ++this.#lastImage;
        this.#images.set(id, { paste, token });
        waiting.left++;
        this.#post({ type: "saveImage", id, data });
      }
      if (waiting.left === 0) this.#finish(paste);
    });
  }

  /** Handles the host's answer for an image. */
  receive(message: Extract<HostMessage, { type: "imageSaved" }>): void {
    const image = this.#images.get(message.id);
    if (!image) return;
    this.#images.delete(message.id);
    const waiting = this.#pastes.get(image.paste);
    if (!waiting) return;
    waiting.paths.set(image.token, message.path);
    if (--waiting.left === 0) this.#finish(image.paste);
  }

  #finish(paste: number): void {
    const waiting = this.#pastes.get(paste);
    this.#pastes.delete(paste);
    const view = this.#view;
    const range = view && rangesKey.getState(view.state)?.get(paste);
    // A document loaded since the paste was made has no range for it.
    if (!waiting || !view || !range) return;
    const slice = new Slice(
      withPaths(waiting.slice.content, waiting.paths),
      waiting.slice.openStart,
      waiting.slice.openEnd,
    );
    const { selection } = view.state;
    const tr: Transaction = view.state.tr.setMeta(rangesKey, { remove: paste } satisfies RangeMeta);
    if (slice.size > 0) {
      if (selection.from === range.from && selection.to === range.to) tr.replaceSelection(slice).scrollIntoView();
      else tr.replaceRange(range.from, range.to, slice);
      tr.setMeta("paste", true).setMeta("uiEvent", "paste");
    }
    view.dispatch(tr);
  }
}

/** `content` with each image whose `src` is a token in `paths` given its path, or left out when it has none. */
function withPaths(content: Fragment, paths: ReadonlyMap<string, string | null>): Fragment {
  const nodes: Node[] = [];
  content.forEach((node) => {
    const src = node.type === schema.nodes.image ? (node.attrs["src"] as string) : null;
    if (src === null || !paths.has(src)) {
      nodes.push(node.isLeaf ? node : node.copy(withPaths(node.content, paths)));
      return;
    }
    const path = paths.get(src);
    if (path) nodes.push(node.type.create({ ...node.attrs, src: path }, null, node.marks));
  });
  return Fragment.fromArray(nodes);
}
