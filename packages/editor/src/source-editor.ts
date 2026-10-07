import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { Annotation, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, highlightSpecialChars, keymap } from "@codemirror/view";
import type { EditorMessage, HostMessage } from "@wysidown/core";
import type { FindTarget } from "./find.ts";
import { SourceFind } from "./source-find.ts";
import type { SourceSelection } from "./source-selection.ts";
import { SourceSession, type ShownChange } from "./source-session.ts";

/** A pane that edits the markdown source as text. */
export interface SourceEditor {
  /** Passes a message from the host to the pane. */
  receive(message: HostMessage): void;
  readonly view: EditorView;
  /** Find and replace in the source, for the find bar. */
  readonly find: FindTarget;
  /** The selection as offsets in the document's source. */
  sourceSelection(): SourceSelection;
  destroy(): void;
}

export interface SourceEditorOptions {
  /** Source offsets to select when the first document loads, in place of its start. */
  selection?: SourceSelection;
  /** True to take the keyboard when the first document loads. */
  focus?: boolean;
}

const fromHost = Annotation.define<boolean>();

/** Colours from the editor's theme variables (`editor.css`), in place of CodeMirror's light defaults. */
const theme = EditorView.theme({
  "&": { background: "var(--wysidown-background)", color: "var(--wysidown-foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace', lineHeight: "1.5" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--wysidown-foreground)" },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    background: "var(--wysidown-selection)",
  },
  ".cm-specialChar": { color: "var(--wysidown-link)" },
  ".cm-panels": { display: "none" },
  ".cm-line .cm-searchMatch": {
    background: "var(--wysidown-find-match-highlight)",
    outline: "var(--wysidown-find-match-highlight-border)",
  },
  ".cm-line .cm-searchMatch.cm-searchMatch-selected": {
    background: "var(--wysidown-find-match)",
    outline: "var(--wysidown-find-match-border)",
  },
});

/**
 * Mounts a CodeMirror pane in `place` and sends `ready`. It speaks the same protocol as
 * `createEditor`: the host answers with `load` and passes every later message to `receive`. The
 * pane is in a shadow root, where CodeMirror's styles are constructed stylesheets that a
 * `style-src 'self'` policy allows; it takes its colours from the page's `--wysidown-*` variables.
 */
export function createSourceEditor(
  place: HTMLElement,
  post: (message: EditorMessage) => void,
  options: SourceEditorOptions = {},
): SourceEditor {
  const session = new SourceSession(post);
  let selection = options.selection;
  let focus = options.focus === true;
  const find = new SourceFind((): EditorView => view);
  const extensions = (loaded: boolean) => [
    history(),
    drawSelection(),
    highlightSpecialChars(),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": "Markdown source" }),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.editable.of(loaded),
    theme,
    find.extension,
    EditorView.updateListener.of((update) => {
      for (const tr of update.transactions) {
        if (!tr.docChanged || tr.annotation(fromHost)) continue;
        const changes: ShownChange[] = [];
        tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
          changes.push({ from, to, insert: inserted.toString() });
        });
        session.change(changes);
      }
    }),
  ];
  const host = place.ownerDocument.createElement("div");
  host.className = "source-pane";
  place.append(host);
  const root = host.attachShadow({ mode: "open" });
  const view = new EditorView({ root, parent: root, state: EditorState.create({ extensions: extensions(false) }) });
  post({ type: "ready" });
  return {
    receive(message) {
      const shown = session.receive(message);
      if (shown === null) return;
      if (message.type === "load") {
        const anchor = selection ? Math.min(session.toShown(selection.anchor), shown.length) : 0;
        const head = selection ? Math.min(session.toShown(selection.head), shown.length) : 0;
        selection = undefined;
        view.setState(
          EditorState.create({
            doc: shown,
            selection: EditorSelection.single(anchor, head),
            extensions: extensions(true),
          }),
        );
        view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
        find.restore();
        if (focus) view.focus();
        focus = false;
        return;
      }
      const { main } = view.state.selection;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: shown },
        selection: EditorSelection.single(Math.min(main.anchor, shown.length), Math.min(main.head, shown.length)),
        annotations: [fromHost.of(true), Transaction.addToHistory.of(false)],
      });
    },
    view,
    find,
    sourceSelection() {
      const { main } = view.state.selection;
      return { anchor: session.fromShown(main.anchor), head: session.fromShown(main.head) };
    },
    destroy() {
      view.destroy();
      host.remove();
    },
  };
}
