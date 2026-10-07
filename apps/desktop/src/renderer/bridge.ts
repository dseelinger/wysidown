import type { EditorMessage, HostMessage } from "@wysidown/core";
import type { Theme } from "./theme.ts";

/** What the preload script exposes to the page as `window.wysidown`. */
export interface Bridge {
  /** Sends a message to the host. */
  post(message: EditorMessage): void;
  /** Calls `listener` with every message from the host. */
  onMessage(listener: (message: HostMessage) => void): void;
  /** Asks the host to open a file dropped on the window. */
  openFile(file: File): void;
  /** Calls `listener` when the host switches between the markdown source (true) and the rendered document. */
  onSourceMode(listener: (on: boolean) => void): void;
  /** Calls `listener` when the user chooses Find (false) or Replace (true) from the menu. */
  onFind(listener: (replace: boolean) => void): void;
  /** Calls `listener` with the theme at once, and again each time the user chooses one. */
  onTheme(listener: (theme: Theme) => void): void;
}

declare global {
  interface Window {
    wysidown: Bridge;
  }
}
