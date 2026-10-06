import type { TextEdit } from "../text/edits.ts";

/**
 * Messages between a host (desktop main process, VS Code extension) and the editor in its webview.
 * `version` is the host's document version: the host increments it on every change to the text,
 * whatever its source, and the editor states the version its edits were computed against.
 */

/** Sent by the host. */
export type HostMessage =
  /** The document to show, replacing any other. */
  | { type: "load"; text: string; version: number }
  /** The text changed outside the editor (another editor, undo in the host, a file change on disk). */
  | { type: "changed"; text: string; version: number }
  /** The host applied the editor's edits; `version` is the version after them. */
  | { type: "accepted"; version: number }
  /**
   * The host is about to read its text (to save it, or to ask whether to save it) and waits for
   * `flushed`. `id` increases with each `flush`.
   */
  | { type: "flush"; id: number };

/** Sent by the editor. */
export type EditorMessage =
  /** The editor is ready for `load`. */
  | { type: "ready" }
  /**
   * The user edited the document. `edits` refer to the text at `baseVersion`. A host whose
   * version has moved on discards them and replies with `changed`.
   */
  | { type: "edit"; baseVersion: number; edits: readonly TextEdit[] }
  /**
   * Answers `flush`: every change the user made before it has been sent as an edit and accepted,
   * or replaced by the host's text. Messages before it are handled first. `id` is that of the
   * latest `flush` answered; earlier ones are answered with it.
   */
  | { type: "flushed"; id: number };
