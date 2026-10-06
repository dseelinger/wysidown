import {
  diffText,
  parseMarkdown,
  schema,
  serializeMarkdown,
  type EditorMessage,
  type HostMessage,
  type MarkdownSource,
} from "@wysidown/core";
import { Fragment, type Node } from "prosemirror-model";
import { EditorState, Selection, type Plugin, type Transaction } from "prosemirror-state";
import { fromHost, keepReferencedDefinitions } from "./definitions.ts";
import { keepATextblock, shown, written } from "./empty-document.ts";

/**
 * The editor's side of the host protocol, with no view. Writes the document against the source of
 * the host's text and sends the difference as an edit. At most one edit is in flight; changes made
 * meanwhile are sent when the host accepts it.
 */
export class Session {
  readonly #post: (message: EditorMessage) => void;
  readonly #plugins: readonly Plugin[];
  #state: EditorState;
  /** The source the serializer writes against; its nodes are the unedited nodes of the document. */
  #source: MarkdownSource | null = null;
  #version = 0;
  /** The host's text at `#version`. */
  #hostText = "";
  /** The text the in-flight edit produces; null when no edit is in flight. */
  #sent: string | null = null;
  #written: { doc: Node; text: string } | null = null;
  /** The id of the latest `flush` not yet answered; null when none is waiting. */
  #flushAsked: number | null = null;

  constructor(post: (message: EditorMessage) => void, plugins: readonly Plugin[] = []) {
    this.#post = post;
    this.#plugins = [keepReferencedDefinitions, keepATextblock, ...plugins];
    this.#state = EditorState.create({ schema, plugins: [...this.#plugins] });
  }

  get state(): EditorState {
    return this.#state;
  }

  /** True once the host has sent a document. */
  get loaded(): boolean {
    return this.#source !== null;
  }

  /** Handles a message from the host. Returns the new state when the message changed it. */
  receive(message: HostMessage): EditorState | null {
    switch (message.type) {
      case "load": {
        this.#source = parseMarkdown(message.text);
        const doc = shown(this.#source.doc);
        this.#state = EditorState.create({
          doc,
          selection: firstText(doc),
          plugins: [...this.#plugins],
        });
        this.#reset(message.text, message.version);
        return this.#state;
      }
      case "changed": {
        if (!this.#source || message.version <= this.#version) return null;
        const source = parseMarkdown(message.text);
        this.#state = this.#state.apply(replaceChangedBlocks(this.#state, shown(source.doc)));
        this.#source = source.doc.childCount === 0 ? source : adopt(source, this.#state.doc);
        this.#reset(message.text, message.version);
        return this.#state;
      }
      case "accepted":
        if (this.#sent === null) return null;
        this.#hostText = this.#sent;
        this.#version = message.version;
        this.#sent = null;
        this.#flush();
        return null;
      case "flush":
        this.#flushAsked = message.id;
        this.#flush();
        return null;
    }
  }

  /** Records a state the user produced from the current one, and sends the edit if its text differs. */
  update(state: EditorState): void {
    this.#state = state;
    this.#flush();
  }

  #reset(text: string, version: number): void {
    this.#hostText = text;
    this.#version = version;
    this.#sent = null;
    this.#written = null;
    this.#answerFlush();
  }

  /** Sends the document's changes as an edit unless one is in flight; answers a pending `flush` once none is. */
  #flush(): void {
    if (this.#source && this.#sent === null) {
      const doc = this.#state.doc;
      if (this.#written?.doc !== doc)
        this.#written = { doc, text: serializeMarkdown(this.#source, written(doc, this.#source)).text };
      const edit = diffText(this.#hostText, this.#written.text);
      if (edit) {
        this.#sent = this.#written.text;
        this.#post({ type: "edit", baseVersion: this.#version, edits: [edit] });
      }
    }
    this.#answerFlush();
  }

  #answerFlush(): void {
    if (this.#flushAsked === null || this.#sent !== null) return;
    this.#post({ type: "flushed", id: this.#flushAsked });
    this.#flushAsked = null;
  }
}

/**
 * A transaction that turns `state.doc` into a document equal to `doc` by replacing only the
 * top-level blocks that differ. It is left out of the undo history and may delete definitions.
 */
export function replaceChangedBlocks(state: EditorState, doc: Node): Transaction {
  const before = state.doc;
  let start = 0;
  while (start < before.childCount && start < doc.childCount && before.child(start).eq(doc.child(start))) start++;
  let endBefore = before.childCount;
  let endAfter = doc.childCount;
  while (endBefore > start && endAfter > start && before.child(endBefore - 1).eq(doc.child(endAfter - 1))) {
    endBefore--;
    endAfter--;
  }
  const tr = state.tr.setMeta("addToHistory", false).setMeta(fromHost, true);
  if (start === endBefore && start === endAfter) return tr;
  const blocks: Node[] = [];
  for (let k = start; k < endAfter; k++) blocks.push(doc.child(k));
  return tr.replaceWith(offsetOf(before, start), offsetOf(before, endBefore), Fragment.fromArray(blocks));
}

/** A cursor in the first text of `doc`, so that typing after a load does not replace raw syntax at its start. */
function firstText(doc: Node): Selection {
  return Selection.findFrom(doc.resolve(0), 1, true) ?? Selection.atStart(doc);
}

/** The position before child `index` of `doc`. */
function offsetOf(doc: Node, index: number): number {
  let pos = 0;
  for (let k = 0; k < index; k++) pos += doc.child(k).nodeSize;
  return pos;
}

/** `source` with its ranges keyed to the nodes of `doc`, which must equal `source.doc`. */
export function adopt(source: MarkdownSource, doc: Node): MarkdownSource {
  if (!doc.eq(source.doc)) throw new Error("adopt: the document does not equal the source's document");
  const ranges: MarkdownSource["ranges"] = new WeakMap();
  const chars: MarkdownSource["chars"] = new WeakMap();
  const copy = (from: Node, to: Node) => {
    const range = source.ranges.get(from);
    if (range) ranges.set(to, range);
    const map = source.chars.get(from);
    if (map) chars.set(to, map);
    from.forEach((child, _, index) => {
      copy(child, to.child(index));
    });
  };
  copy(source.doc, doc);
  return { ...source, doc, ranges, chars };
}
