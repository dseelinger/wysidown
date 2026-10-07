import type { TextEdit } from "../text/edits.ts";

/**
 * Messages between a host (desktop main process, VS Code extension) and the editor in its webview.
 * `version` is the host's document version. The host adds one for each edit of the editor's it
 * applies, and gives every `changed`, and every `load` of different text, a version later than any
 * it sent before. The editor sends each change as it is made, stating the version its edits were
 * computed against.
 */

/** Where the document's images and links lead. */
export interface Resources {
  /** A URL ending in `/` that relative paths resolve against: the document's folder. Null when the document has no file. */
  base: string | null;
  /**
   * A URL ending in `/` that paths starting with `/` resolve against: the repository root, or the
   * document's folder outside a repository. The host serves no file outside it. Null when `base` is.
   */
  root: string | null;
  /** False when images from the web are not loaded. */
  remoteImages: boolean;
}

/** Sent by the host. */
export type HostMessage =
  /** The document to show, replacing any other, and where its images and links lead when that changed. */
  | { type: "load"; text: string; version: number; resources?: Resources }
  /**
   * The text changed outside the editor (another editor, undo in the host, a file change on disk),
   * or the host did not apply an edit. The editor's edits not yet accepted are discarded.
   */
  | { type: "changed"; text: string; version: number }
  /** The host applied the editor's edits; `version` is the version after them. */
  | { type: "accepted"; version: number }
  /**
   * The host is about to read its text (to save it, or to ask whether to save it) and waits for
   * `flushed`. `id` increases with each `flush`.
   */
  | { type: "flush"; id: number }
  /** Where the document's images and links now lead. */
  | ({ type: "resources" } & Resources);

/** Sent by the editor. */
export type EditorMessage =
  /** The editor is ready for `load`. */
  | { type: "ready" }
  /**
   * The user edited the document. `edits` refer to the text at `baseVersion`: the latest version
   * the editor received, `seenVersion`, plus one for each of its earlier edits not yet accepted. A
   * host that sent `load` or `changed` after `seenVersion` ignores the edit, since the editor
   * discards it on receiving that message. Otherwise a host whose version is not `baseVersion`, or
   * that cannot apply the edits, replies with `changed`.
   */
  | { type: "edit"; baseVersion: number; seenVersion: number; edits: readonly TextEdit[] }
  /**
   * Answers `flush`: every change the user made before it has been sent as an edit and accepted,
   * or replaced by the host's text. Messages before it are handled first. `id` is that of the
   * latest `flush` answered; earlier ones are answered with it.
   */
  | { type: "flushed"; id: number }
  /**
   * The user followed a link to another markdown file, or to a web or mail address. `href` is the
   * link's target as written, for the host to open the file it names (see `markdownLinkPath`) or,
   * for a scheme in `externalSchemes`, the address. `href` is untrusted.
   */
  | { type: "open"; href: string };
