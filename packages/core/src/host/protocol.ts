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
  | { type: "accepted"; version: number };

/** Sent by the editor. */
export type EditorMessage =
  /** The editor is ready for `load`. */
  | { type: "ready" }
  /**
   * The user edited the document. `edits` refer to the text at `baseVersion`. A host whose
   * version has moved on discards them and replies with `changed`.
   */
  | { type: "edit"; baseVersion: number; edits: readonly TextEdit[] };
