import { applyEdits, type EditorMessage, type HostMessage, type Resources, type TextEdit } from "@wysidown/core";

/** The document a window shows: its text, the file it came from, and whether it has unsaved changes. */
export class HostDocument {
  readonly #send: (message: HostMessage) => void;
  readonly #onDirtyChange: () => void;
  #path: string | null = null;
  #text = "";
  #saved = "";
  #resources: Resources = { base: null, root: null, remoteImages: false };
  #version = 1;
  /** The version of the latest `load` or `changed` sent. */
  #told = 1;
  /** The pending `flush` calls, oldest first. */
  #flushes: { id: number; resolve: () => void }[] = [];
  #lastFlush = 0;

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
      this.#told = this.#version;
      this.#send({ type: "load", text: this.#text, version: this.#version, resources: this.#resources });
      return;
    }
    if (isFlushed(message)) {
      const answered = this.#flushes.filter((f) => f.id <= message.id);
      this.#flushes = this.#flushes.filter((f) => f.id > message.id);
      for (const f of answered) f.resolve();
      return;
    }
    if (!isEdit(message) || message.seenVersion < this.#told) return;
    let text: string;
    try {
      if (message.baseVersion !== this.#version) throw new Error("the edit is not based on the current version");
      text = applyEdits(this.#text, message.edits);
    } catch {
      this.#told = ++this.#version;
      this.#send({ type: "changed", text: this.#text, version: this.#version });
      return;
    }
    const wasDirty = this.dirty;
    this.#text = text;
    this.#version++;
    this.#send({ type: "accepted", version: this.#version });
    if (this.dirty !== wasDirty) this.#onDirtyChange();
  }

  /**
   * Asks the editor to send its changes and resolves once they are applied, or after `ms`
   * milliseconds when the editor does not answer. Call before reading `text` or `dirty` for a save.
   */
  flush(ms = 2000): Promise<void> {
    const id = ++this.#lastFlush;
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.#flushes.push({
        id,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
      this.#send({ type: "flush", id });
    });
  }

  /**
   * Shows `text`, read from `path`, as the document, with its images and links leading to
   * `resources`; it starts with no unsaved changes.
   */
  load(text: string, path: string | null, resources: Resources): void {
    this.#path = path;
    this.#text = text;
    this.#saved = text;
    this.#resources = resources;
    this.#told = ++this.#version;
    this.#send({ type: "load", text, version: this.#version, resources });
    this.#onDirtyChange();
  }

  /** Tells the editor where the document's images and links now lead. */
  setResources(resources: Resources): void {
    this.#resources = resources;
    this.#send({ type: "resources", ...resources });
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

function isFlushed(message: unknown): message is Extract<EditorMessage, { type: "flushed" }> {
  if (typeof message !== "object" || message === null) return false;
  const m = message as { type?: unknown; id?: unknown };
  return m.type === "flushed" && Number.isInteger(m.id);
}

function isEdit(message: unknown): message is Extract<EditorMessage, { type: "edit" }> {
  if (typeof message !== "object" || message === null) return false;
  const m = message as { type?: unknown; baseVersion?: unknown; seenVersion?: unknown; edits?: unknown };
  return (
    m.type === "edit" &&
    Number.isInteger(m.baseVersion) &&
    Number.isInteger(m.seenVersion) &&
    Array.isArray(m.edits) &&
    m.edits.every(isTextEdit)
  );
}

function isTextEdit(edit: unknown): edit is TextEdit {
  if (typeof edit !== "object" || edit === null) return false;
  const e = edit as { start?: unknown; end?: unknown; insert?: unknown };
  return Number.isInteger(e.start) && Number.isInteger(e.end) && typeof e.insert === "string";
}
