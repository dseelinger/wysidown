import { applyEdits, type EditorMessage, type HostMessage } from "@wysidown/core";

/** A host that keeps the document in memory and answers the editor's messages through `send`. */
export class MemoryHost {
  readonly #send: (message: HostMessage) => void;
  #text: string;
  #version = 1;

  constructor(send: (message: HostMessage) => void, text = "") {
    this.#send = send;
    this.#text = text;
  }

  get text(): string {
    return this.#text;
  }

  get version(): number {
    return this.#version;
  }

  receive(message: EditorMessage): void {
    switch (message.type) {
      case "ready":
        this.#send({ type: "load", text: this.#text, version: this.#version });
        return;
      case "edit":
        if (message.baseVersion !== this.#version) {
          this.#send({ type: "changed", text: this.#text, version: this.#version });
          return;
        }
        this.#text = applyEdits(this.#text, message.edits);
        this.#version++;
        this.#send({ type: "accepted", version: this.#version });
    }
  }

  /** Shows a different document, as opening another file does. */
  load(text: string): void {
    this.#text = text;
    this.#version++;
    this.#send({ type: "load", text, version: this.#version });
  }

  /** Changes the text outside the editor, as another program writing the file does. */
  change(text: string): void {
    this.#text = text;
    this.#version++;
    this.#send({ type: "changed", text, version: this.#version });
  }
}
