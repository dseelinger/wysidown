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
import { ReplaceStep } from "prosemirror-transform";
import { fromHost, keepReferencedDefinitions } from "./definitions.ts";
import { keepATextblock, shown, written } from "./empty-document.ts";

/**
 * The editor's side of the host protocol, with no view. Writes the document against the source of
 * the host's text and sends each change as an edit, computed against the text the edits already in
 * flight produce. Typing is held for `hold` milliseconds after the last keystroke, so that a word
 * reaches the host as one edit; every other change is sent straight away, with any held typing.
 */
export class Session {
  readonly #post: (message: EditorMessage) => void;
  readonly #plugins: readonly Plugin[];
  readonly #hold: number;
  /** Sends held typing once the pause after the last keystroke ends; undefined when nothing is held. */
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** The state before the held typing, whose text is the host's once the edits in flight are applied; null when nothing is held. */
  #beforeHeld: EditorState | null = null;
  #state: EditorState;
  /** The source the serializer writes against; its nodes are the unedited nodes of the document. */
  #source: MarkdownSource | null = null;
  /** The latest version received from the host. */
  #version = 0;
  /** The host's text at `#version`. */
  #hostText = "";
  /** The text each edit in flight produces, oldest first. The host's version after the k-th is `#version + k + 1`. */
  #sent: string[] = [];
  #written: { doc: Node; text: string } | null = null;
  /** The id of the latest `flush` not yet answered; null when none is waiting. */
  #flushAsked: number | null = null;

  /** `hold` is how long typing waits for more typing before it is sent; 0 sends each change at once. */
  constructor(post: (message: EditorMessage) => void, plugins: readonly Plugin[] = [], hold = 0) {
    this.#post = post;
    this.#hold = hold;
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

  /** The host's text once the edits sent are applied; held typing is not in it. */
  get text(): string {
    return this.#sent.at(-1) ?? this.#hostText;
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
        this.#stopHolding();
        this.#reset(message.text, message.version);
        return this.#state;
      }
      case "changed": {
        if (!this.#source || message.version <= this.#version) return null;
        const source = parseMarkdown(message.text);
        const doc = shown(source.doc);
        const held = this.#beforeHeld;
        const kept = held && keepTyping(held, this.#state, doc);
        // `host` is the state whose document is the host's text: the one the held typing applies to.
        const host = held ? held.apply(replaceChangedBlocks(held, doc)) : null;
        this.#state = kept ?? host ?? this.#state.apply(replaceChangedBlocks(this.#state, doc));
        this.#source = source.doc.childCount === 0 ? source : adopt(source, (host ?? this.#state).doc);
        this.#reset(message.text, message.version);
        if (kept) this.#beforeHeld = host;
        else this.#stopHolding();
        return this.#state;
      }
      case "accepted": {
        const text = this.#sent.shift();
        if (text === undefined) return null;
        this.#hostText = text;
        this.#version = message.version;
        this.#answerFlush();
        return null;
      }
      case "flush":
        this.#flushAsked = message.id;
        this.#flush();
        return null;
      case "resources":
      case "imageSaved":
        return null;
    }
  }

  /**
   * Records a state the user produced from the current one with `tr`, and sends the edit if its text
   * differs. Typing in `tr` is held; a state given without `tr` is sent at once.
   */
  update(state: EditorState, tr?: Transaction): void {
    const before = this.#state;
    this.#state = state;
    if (this.#hold > 0 && tr && !tr.docChanged && !tr.selectionSet) return;
    if (this.#hold > 0 && tr && typing(tr)) {
      if (startsWord(tr)) {
        this.#send(before.doc);
        this.#beforeHeld = before;
      } else {
        this.#beforeHeld ??= before;
      }
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => {
        this.#flush();
      }, this.#hold);
      return;
    }
    this.#flush();
  }

  /** True while typing is held. */
  get holding(): boolean {
    return this.#beforeHeld !== null;
  }

  /** Sends any held typing now, as when the editor is about to lose the keyboard or the page. */
  sendHeld(): void {
    if (this.holding) this.#flush();
  }

  /**
   * Discards the held typing, which the host has not seen, and returns the state before it: undo
   * of the typing the host would otherwise receive after its own undo. Null when nothing is held.
   */
  undoHeld(): EditorState | null {
    const state = this.#beforeHeld;
    if (!state) return null;
    this.#stopHolding();
    this.#state = state;
    return state;
  }

  #stopHolding(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#beforeHeld = null;
  }

  #reset(text: string, version: number): void {
    this.#hostText = text;
    this.#version = version;
    this.#sent = [];
    this.#written = null;
    this.#answerFlush();
  }

  /** Sends the document's changes, held typing included, as an edit; answers a pending `flush` once no edit is in flight. */
  #flush(): void {
    this.#stopHolding();
    this.#send(this.#state.doc);
    this.#answerFlush();
  }

  /** Sends the changes that make the host's text that of `doc`, if there are any. */
  #send(doc: Node): void {
    if (!this.#source) return;
    if (this.#written?.doc !== doc)
      this.#written = { doc, text: serializeMarkdown(this.#source, written(doc, this.#source)).text };
    const edit = diffText(this.#sent.at(-1) ?? this.#hostText, this.#written.text);
    if (!edit) return;
    const baseVersion = this.#version + this.#sent.length;
    this.#sent.push(this.#written.text);
    this.#post({ type: "edit", baseVersion, seenVersion: this.#version, edits: [edit] });
  }

  #answerFlush(): void {
    if (this.#flushAsked === null || this.#sent.length > 0) return;
    this.#post({ type: "flushed", id: this.#flushAsked });
    this.#flushAsked = null;
  }
}

/**
 * A transaction that turns `state.doc` into a document equal to `doc` by replacing only the
 * top-level blocks that differ. It is left out of the undo history and may delete definitions.
 */
export function replaceChangedBlocks(state: EditorState, doc: Node): Transaction {
  return replaceBlocks(state, doc, changedBlocks(state.doc, doc));
}

/** The top-level blocks that differ: `before`'s from `start` to `endBefore` became `doc`'s from `start` to `endAfter`. */
interface ChangedBlocks {
  start: number;
  endBefore: number;
  endAfter: number;
}

function changedBlocks(before: Node, doc: Node): ChangedBlocks {
  let start = 0;
  while (start < before.childCount && start < doc.childCount && before.child(start).eq(doc.child(start))) start++;
  let endBefore = before.childCount;
  let endAfter = doc.childCount;
  while (endBefore > start && endAfter > start && before.child(endBefore - 1).eq(doc.child(endAfter - 1))) {
    endBefore--;
    endAfter--;
  }
  return { start, endBefore, endAfter };
}

/** Replaces `state`'s blocks from `start` to `endBefore` with `doc`'s from `start` to `endAfter`. */
function replaceBlocks(state: EditorState, doc: Node, { start, endBefore, endAfter }: ChangedBlocks): Transaction {
  const tr = state.tr.setMeta("addToHistory", false).setMeta(fromHost, true);
  if (start === endBefore && start === endAfter) return tr;
  const blocks: Node[] = [];
  for (let k = start; k < endAfter; k++) blocks.push(doc.child(k));
  return tr.replaceWith(offsetOf(state.doc, start), offsetOf(state.doc, endBefore), Fragment.fromArray(blocks));
}

/**
 * `state`, whose typing since `held` the host has not seen, with the host's change from `held.doc`
 * to `doc` applied. Null when the host changed a block the typing is in.
 */
function keepTyping(held: EditorState, state: EditorState, doc: Node): EditorState | null {
  if (held.doc.childCount !== state.doc.childCount) return null;
  const change = changedBlocks(held.doc, doc);
  for (let k = change.start; k < change.endBefore; k++) if (held.doc.child(k) !== state.doc.child(k)) return null;
  return state.apply(replaceBlocks(state, doc, change));
}

/**
 * True when `tr` is a keystroke of typing: text inserted at the cursor, or one character deleted,
 * within one textblock. A paste, a drop, a cut, Enter and a command that changes structure are not.
 */
function typing(tr: Transaction): boolean {
  if (tr.steps.length !== 1 || tr.getMeta("uiEvent") !== undefined) return false;
  const step = tr.steps[0];
  if (!(step instanceof ReplaceStep) || step.slice.openStart !== 0 || step.slice.openEnd !== 0) return false;
  const inserted = step.slice.content;
  for (let k = 0; k < inserted.childCount; k++) if (!inserted.child(k).isText) return false;
  if (step.to - step.from > (inserted.size > 0 ? 0 : 1)) return false;
  const $from = tr.before.resolve(step.from);
  return $from.parent.isTextblock && $from.sameParent(tr.before.resolve(step.to));
}

/** True when `tr` types whitespace straight after other text: the end of a word. */
function startsWord(tr: Transaction): boolean {
  const step = tr.steps[0] as ReplaceStep;
  const typed = step.slice.content.textBetween(0, step.slice.content.size);
  if (!/^\s$/.test(typed)) return false;
  const $from = tr.before.resolve(step.from);
  const previous = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc").slice(-1);
  return previous !== "" && !/\s/.test(previous);
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
