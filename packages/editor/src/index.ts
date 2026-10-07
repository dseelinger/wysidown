// Public API of @wysidown/editor: the ProseMirror view both hosts load, and a CodeMirror pane for the source. Uses the DOM; imports no host.
// Hosts load `src/editor.css` alongside the bundle.
export { createEditor, type Editor, type EditorOptions } from "./editor.ts";
export { createFindBar, type FindBar, type FindQuery, type FindTarget } from "./find.ts";
export { Session, replaceChangedBlocks } from "./session.ts";
export { createSourceEditor, type SourceEditor, type SourceEditorOptions } from "./source-editor.ts";
export type { SourceSelection } from "./source-selection.ts";
