import type { EditorMessage, HostMessage } from "@wysidown/core";
import { history } from "prosemirror-history";
import type { EditorState, Plugin, Transaction } from "prosemirror-state";
import { MemoryHost } from "../../harness/memory-host.ts";
import { Session } from "../../src/session.ts";

/**
 * A session and an in-memory host joined by two queues. Nothing is delivered until a test says
 * so, which lets a test choose the order in which messages cross.
 */
export class Wire {
  readonly toHost: EditorMessage[] = [];
  readonly toEditor: HostMessage[] = [];
  /** Every edit the editor sent, in order. */
  readonly edits: Extract<EditorMessage, { type: "edit" }>[] = [];
  readonly session: Session;
  readonly host: MemoryHost;

  /** `hold` is the session's pause before it sends typing, in milliseconds; `plugins` go in the state after the history. */
  constructor(text: string, hold = 0, plugins: readonly Plugin[] = []) {
    this.session = new Session(
      (m) => {
        if (m.type === "edit") this.edits.push(m);
        this.toHost.push(m);
      },
      [history(), ...plugins],
      hold,
    );
    this.host = new MemoryHost((m) => this.toEditor.push(m), text);
    this.toHost.push({ type: "ready" });
    this.drain();
  }

  get state(): EditorState {
    return this.session.state;
  }

  /** Applies a user transaction built on the current state. */
  edit(build: (state: EditorState) => Transaction): void {
    const tr = build(this.state);
    this.session.update(this.state.apply(tr), tr);
  }

  /** Delivers the oldest message waiting for the host. */
  deliverToHost(): void {
    this.host.receive(this.toHost.shift()!);
  }

  /** Delivers the oldest message waiting for the editor. */
  deliverToEditor(): void {
    this.session.receive(this.toEditor.shift()!);
  }

  /** Delivers every message, in order, until none is waiting. */
  drain(): void {
    while (this.toHost.length > 0 || this.toEditor.length > 0) {
      if (this.toHost.length > 0) this.deliverToHost();
      if (this.toEditor.length > 0) this.deliverToEditor();
    }
  }
}
