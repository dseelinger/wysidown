import {
  closeSearchPanel,
  findNext,
  findPrevious,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection, type Extension, type Text } from "@codemirror/state";
import { EditorView, type Command } from "@codemirror/view";
import type { FindQuery, FindTarget } from "./find.ts";

/**
 * Find and replace in the source pane, with `@codemirror/search`. Its search panel is open but
 * hidden while there is a query, since CodeMirror highlights matches only then. Its `extension`
 * goes in the pane's state, and `restore` puts the query back in a state created after it.
 */
export class SourceFind implements FindTarget {
  readonly #view: () => EditorView;
  #query: SearchQuery | null = null;
  #listener: (() => void) | null = null;
  readonly extension: Extension = [
    search({
      literal: true,
      createPanel: (view) => {
        const dom = view.dom.ownerDocument.createElement("div");
        dom.hidden = true;
        return { dom };
      },
    }),
    EditorView.updateListener.of(() => this.#listener?.()),
  ];

  constructor(view: () => EditorView) {
    this.#view = view;
  }

  setQuery(query: FindQuery | null, select: boolean): void {
    const view = this.#view();
    if (!query) {
      this.#query = null;
      closeSearchPanel(view);
      return;
    }
    const next = new SearchQuery({ ...query, literal: true });
    this.#query = next;
    this.#show(view);
    const { state } = view;
    const match = select && next.valid ? first(next, state.doc, state.selection.main.from) : null;
    view.dispatch({
      effects: [setSearchQuery.of(next), ...(match ? [EditorView.scrollIntoView(match.from, { y: "center" })] : [])],
      ...(match && { selection: EditorSelection.single(match.from, match.to) }),
    });
  }

  /** Shows the query again after the pane's state was replaced. */
  restore(): void {
    const view = this.#view();
    if (!this.#query) return;
    this.#show(view);
    view.dispatch({ effects: setSearchQuery.of(this.#query) });
  }

  matches(): { current: number; total: number } {
    const query = this.#query;
    if (!query?.valid) return { current: 0, total: 0 };
    const { state } = this.#view();
    const { from, to } = state.selection.main;
    let current = 0;
    let total = 0;
    const cursor = query.getCursor(state);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      if (next.value.to === next.value.from) continue;
      total++;
      if (next.value.from === from && next.value.to === to) current = total;
    }
    return { current, total };
  }

  findNext(): void {
    this.#run(findNext);
  }

  findPrevious(): void {
    this.#run(findPrevious);
  }

  replace(): void {
    this.#run(replaceNext);
  }

  replaceAll(): void {
    this.#run(replaceAll);
  }

  selectedText(): string {
    const { state } = this.#view();
    const { from, to } = state.selection.main;
    const text = state.sliceDoc(from, to);
    return text.includes("\n") ? "" : text;
  }

  onUpdate(listener: (() => void) | null): void {
    this.#listener = listener;
  }

  focus(): void {
    this.#view().focus();
  }

  #show(view: EditorView): void {
    if (!searchPanelOpen(view.state)) openSearchPanel(view);
  }

  #run(command: Command): void {
    if (this.#query?.valid) command(this.#view());
  }
}

/** The first non-empty match of `query` at or after `from`, wrapping round to the start. */
function first(query: SearchQuery, doc: Text, from: number): { from: number; to: number } | null {
  for (const start of [from, 0]) {
    const cursor = query.getCursor(doc, start);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      if (next.value.to > next.value.from) return next.value;
    }
  }
  return null;
}
