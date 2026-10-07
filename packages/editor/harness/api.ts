import type { EditorMessage, HostMessage, Resources } from "@wysidown/core";

/** What the harness page exposes to Playwright as `window.harness`. */
export interface Harness {
  /** The host's text. */
  text(): string;
  /** The host's document version. */
  version(): number;
  load(text: string): void;
  /** Changes the text outside the editor. */
  change(text: string): void;
  /** Asks the editor to send its changes, as a host does before a save; resolves with the host's text once it has. */
  flush(): Promise<string>;
  /** Tells the editor where images and links lead. */
  resources(resources: Resources): void;
  /** Each pasted image the host saved, oldest first, with its bytes in base64. */
  images(): { path: string; data: string }[];
  /** False to make the host refuse pasted images, as for a document with no file. */
  hasFolder(on: boolean): void;
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
