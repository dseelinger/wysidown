// Public API of @wysidown/core. Runs with no DOM and no host: see the layering rule in CLAUDE.md.
export { schema } from "./markdown/schema.ts";
export { parseMarkdown } from "./markdown/parse.ts";
export { serializeMarkdown, type SaveResult, type Step } from "./markdown/serialize.ts";
export type { MarkdownSource, Range, Style } from "./markdown/source.ts";
export {
  alignTableColumn,
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  type Alignment,
} from "./markdown/tables.ts";
export { diffText, applyEdits, type TextEdit } from "./text/edits.ts";
export type { HostMessage, EditorMessage } from "./host/protocol.ts";
