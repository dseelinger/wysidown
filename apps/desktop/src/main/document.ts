import { applyEdits, type EditorMessage, type HostMessage, type TextEdit } from "@wysidown/core";

/** The document a window shows: its text, the file it came from, and whether it has unsaved changes. */
export class HostDocument {
  readonly #send: (message: HostMessage) => void;
  readonly #onDirtyChange: () => void;
  #path: string | null = null;
  #text = "";
  #saved = "";
  #version = 1;

  constructor(send: (message: HostMessage) => void, onDirtyChange: () => void) {
    this.#send = send;
    this.#onDirtyChange = onDirtyChange;
  }

  /** The file the document saves to; null for a document never saved. */
  get path(): string | null {
    return this.#path;
  }

  get text(): string {
    return this.#text;
  }

  /** True when the text differs from the file's. */
  get dirty(): boolean {
    return this.#text !== this.#saved;
  }

  /** Handles a message from the editor. `message` is untrusted: anything malformed is ignored. */
  receive(message: unknown): void {
    if (isReady(message)) {
      this.#send({ type: "load", text: this.#text, version: this.#version });
      return;
    }
    if (!isEdit(message)) return;
    if (message.baseVersion !== this.#version) {
      this.#send({ type: "changed", text: this.#text, version: this.#version });
      return;
    }
    let text: string;
    try {
      text = applyEdits(this.#text, message.edits);
    } catch {
      this.#send({ type: "changed", text: this.#text, version: this.#version });
      return;
    }
    const wasDirty = this.dirty;
    this.#text = text;
    this.#version++;
    this.#send({ type: "accepted", version: this.#version });
    if (this.dirty !== wasDirty) this.#onDirtyChange();
  }

  /** Shows `text`, read from `path`, as the document; it starts with no unsaved changes. */
  load(text: string, path: string | null): void {
    this.#path = path;
    this.#text = text;
    this.#saved = text;
    this.#version++;
    this.#send({ type: "load", text, version: this.#version });
    this.#onDirtyChange();
  }

  /** Records that the current text was written to `path`. */
  saved(path: string, text: string): void {
    this.#path = path;
    this.#saved = text;
    this.#onDirtyChange();
  }
}

function isReady(message: unknown): message is Extract<EditorMessage, { type: "ready" }> {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "ready";
}

function isEdit(message: unknown): message is Extract<EditorMessage, { type: "edit" }> {
  if (typeof message !== "object" || message === null) return false;
  const m = message as { type?: unknown; baseVersion?: unknown; edits?: unknown };
  return m.type === "edit" && Number.isInteger(m.baseVersion) && Array.isArray(m.edits) && m.edits.every(isTextEdit);
}

function isTextEdit(edit: unknown): edit is TextEdit {
  if (typeof edit !== "object" || edit === null) return false;
  const e = edit as { start?: unknown; end?: unknown; insert?: unknown };
  return Number.isInteger(e.start) && Number.isInteger(e.end) && typeof e.insert === "string";
}
