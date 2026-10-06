import type { EditorMessage, HostMessage } from "@wysidown/core";

/** What the harness page exposes to Playwright as `window.harness`. */
export interface Harness {
  /** The host's text. */
  text(): string;
  /** The host's document version. */
  version(): number;
  load(text: string): void;
  /** Changes the text outside the editor. */
  change(text: string): void;
  /** Milliseconds each message takes to arrive, in either direction. */
  latency: number;
  /** Every message sent so far, in order. */
  readonly messages: (HostMessage | EditorMessage)[];
  /** True when the editor has read the browser selection, so a key it handles acts at the caret. */
  selectionInSync(): boolean;
  /** Resolves once no message is on its way. */
  settled(): Promise<void>;
}

declare global {
  interface Window {
    harness: Harness;
  }
}
