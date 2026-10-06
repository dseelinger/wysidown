// Public API of @wysidown/editor: the ProseMirror view both hosts load. Uses the DOM; imports no host.
// Hosts load `src/editor.css` alongside the bundle.
export { createEditor, type Editor, type EditorOptions } from "./editor.ts";
export { Session, replaceChangedBlocks } from "./session.ts";
