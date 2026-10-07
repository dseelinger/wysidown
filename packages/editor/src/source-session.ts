import { applyEdits, type EditorMessage, type HostMessage, type TextEdit } from "@wysidown/core";

const byteOrderMark = "\uFEFF";

/** A change to the shown text: `from` to `to`, offsets in the shown text before any of the changes, replaced by `insert`. */
export interface ShownChange {
  from: number;
  to: number;
  /** The inserted text, with "\n" for every line break. */
  insert: string;
}

/** Where each line of a text starts, in the text and in its shown form. */
interface Lines {
  source: number[];
  shown: number[];
  /** Each line's length, without its line break. */
  length: number[];
}

/**
 * The host protocol for a pane that edits the markdown source as plain text, with no view. The
 * text is shown without its byte order mark and with "\n" for every line break, as CodeMirror
 * holds it; edits are sent in the host's offsets, and new line breaks take the file's line ending.
 * Every change is sent at once.
 */
export class SourceSession {
  readonly #post: (message: EditorMessage) => void;
  /** The host's text with every edit sent applied. */
  #text = "";
  #lines: Lines = { source: [0], shown: [0], length: [0] };
  #loaded = false;
  /** The latest version received from the host. */
  #version = 0;
  /** Edits sent and not yet accepted. */
  #inFlight = 0;
  /** The id of the latest `flush` not yet answered; null when none is waiting. */
  #flushAsked: number | null = null;

  constructor(post: (message: EditorMessage) => void) {
    this.#post = post;
  }

  /** True once the host has sent a document. */
  get loaded(): boolean {
    return this.#loaded;
  }

  /** The text as shown: without its byte order mark, with "\n" for every line break. */
  get shown(): string {
    return shownText(this.#source);
  }

  /** Handles a message from the host. Returns the new shown text when the message replaced it. */
  receive(message: HostMessage): string | null {
    switch (message.type) {
      case "load":
      case "changed":
        if (message.type === "changed" && (!this.#loaded || message.version <= this.#version)) return null;
        this.#loaded = true;
        this.#setText(message.text);
        this.#version = message.version;
        this.#inFlight = 0;
        this.#answerFlush();
        return this.shown;
      case "accepted":
        if (this.#inFlight === 0) return null;
        this.#inFlight--;
        this.#version = message.version;
        this.#answerFlush();
        return null;
      case "flush":
        this.#flushAsked = message.id;
        this.#answerFlush();
        return null;
      case "resources":
      case "imageSaved":
        return null;
    }
  }

  /** Sends the user's changes to the shown text. They must not overlap. */
  change(changes: readonly ShownChange[]): void {
    if (!this.#loaded || changes.length === 0) return;
    const bom = this.#bomLength;
    const eol = this.#source.includes("\r\n") ? "\r\n" : "\n";
    const edits: TextEdit[] = changes.map((c) => ({
      start: bom + this.fromShown(c.from),
      end: bom + this.fromShown(c.to),
      insert: c.insert.replace(/\n/g, eol),
    }));
    const baseVersion = this.#version + this.#inFlight;
    this.#setText(applyEdits(this.#text, edits));
    this.#inFlight++;
    this.#post({ type: "edit", baseVersion, seenVersion: this.#version, edits });
  }

  /** The source offset (excluding any byte order mark, as `Range` counts) of shown offset `offset`. */
  fromShown(offset: number): number {
    const { source, shown } = this.#lines;
    const line = lastAtOrBefore(shown, offset);
    return source[line]! + offset - shown[line]!;
  }

  /** The shown offset of source offset `offset`; an offset inside a line break maps to the end of its line. */
  toShown(offset: number): number {
    const { source, shown, length } = this.#lines;
    const line = lastAtOrBefore(source, Math.max(0, offset));
    return shown[line]! + Math.min(offset - source[line]!, length[line]!);
  }

  get #bomLength(): number {
    return this.#text.startsWith(byteOrderMark) ? 1 : 0;
  }

  /** The text without its byte order mark. */
  get #source(): string {
    return this.#text.slice(this.#bomLength);
  }

  #setText(text: string): void {
    this.#text = text;
    this.#lines = linesOf(this.#source);
  }

  #answerFlush(): void {
    if (this.#flushAsked === null || this.#inFlight > 0) return;
    this.#post({ type: "flushed", id: this.#flushAsked });
    this.#flushAsked = null;
  }
}

const lineBreak = /\r\n?|\n/g;

/** `text` with "\n" for every line break, as CodeMirror splits lines. */
function shownText(text: string): string {
  return text.replace(lineBreak, "\n");
}

function linesOf(text: string): Lines {
  const lines: Lines = { source: [0], shown: [0], length: [] };
  for (const m of text.matchAll(lineBreak)) {
    const length = m.index - lines.source.at(-1)!;
    lines.length.push(length);
    lines.source.push(m.index + m[0].length);
    lines.shown.push(lines.shown.at(-1)! + length + 1);
  }
  lines.length.push(text.length - lines.source.at(-1)!);
  return lines;
}

/** The index of the last of the ascending `starts` that is at most `offset`. */
function lastAtOrBefore(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}
