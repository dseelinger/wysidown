import { applyEdits, type EditorMessage, type HostMessage, type TextEdit } from "@wysidown/core";
import * as vscode from "vscode";

/**
 * The host side of the editor protocol for one webview showing `document`. The protocol version is
 * the document's version. Edits are applied as `WorkspaceEdit`s, so VS Code owns undo and save.
 */
export class EditorConnection implements vscode.Disposable {
  readonly #document: vscode.TextDocument;
  readonly #send: (message: HostMessage) => void;
  readonly #listener: vscode.Disposable;
  /** The last version the editor was told about. */
  #version = 0;
  #applying = false;
  #queue = Promise.resolve();

  constructor(document: vscode.TextDocument, send: (message: HostMessage) => void) {
    this.#document = document;
    this.#send = send;
    this.#listener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== document || event.contentChanges.length === 0 || this.#applying) return;
      if (document.version > this.#version) this.#tell("changed");
    });
  }

  /** Handles a message from the editor, in order after earlier ones. `message` is untrusted: anything malformed is ignored. */
  receive(message: unknown): Promise<void> {
    this.#queue = this.#queue.then(() => this.#handle(message));
    return this.#queue;
  }

  dispose(): void {
    this.#listener.dispose();
  }

  async #handle(message: unknown): Promise<void> {
    if (isReady(message)) {
      this.#tell("load");
      return;
    }
    if (!isEdit(message)) return;
    const document = this.#document;
    if (message.baseVersion !== document.version) {
      this.#tell("changed");
      return;
    }
    let expected: string;
    try {
      expected = applyEdits(document.getText(), message.edits);
    } catch {
      this.#tell("changed");
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const e of message.edits) {
      edit.replace(document.uri, new vscode.Range(document.positionAt(e.start), document.positionAt(e.end)), e.insert);
    }
    this.#applying = true;
    let applied: boolean;
    try {
      applied = await vscode.workspace.applyEdit(edit);
    } finally {
      this.#applying = false;
    }
    if (applied && document.getText() === expected) {
      this.#version = document.version;
      this.#send({ type: "accepted", version: this.#version });
    } else {
      this.#tell("changed");
    }
  }

  #tell(type: "load" | "changed"): void {
    this.#version = this.#document.version;
    this.#send({ type, text: this.#document.getText(), version: this.#version });
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
