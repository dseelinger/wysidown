import { closeHistory } from "prosemirror-history";
import type { Mark, Node } from "prosemirror-model";
import {
  findNext,
  findPrev,
  getMatchHighlights,
  getSearchState,
  search,
  SearchQuery,
  setSearchState,
  type SearchResult,
} from "prosemirror-search";
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import type { FindQuery, FindTarget } from "./find.ts";

const none = new SearchQuery({ search: "" });

/** The character the search reads for an image, a hard break or syntax shown as source. */
const leaf = "\ufffc";

/**
 * The search for `query` in the document. A space in a plain query also matches a soft line break,
 * which the document holds as "\n" and shows as a space. A match never takes in a leaf node, nor a
 * line break in code.
 */
function searchFor(query: FindQuery): ConstructorParameters<typeof SearchQuery>[0] {
  return {
    ...query,
    search: query.regexp ? query.search : query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ \\n]"),
    replace: query.regexp ? query.replace : query.replace.replace(/\$/g, "$$$$"),
    regexp: true,
    literal: true,
    filter: (state, match) => {
      if (match.to <= match.from) return false;
      const text = state.doc.textBetween(match.from, match.to, "\n", leaf);
      return !text.includes(leaf) && !(state.doc.resolve(match.from).parent.type.spec.code && text.includes("\n"));
    },
  };
}

/** What the document's find target acts on: the editor's state, and the way to change it. */
export interface FindView {
  state(): EditorState;
  dispatch(tr: Transaction): void;
  focus(): void;
}

/**
 * Find and replace in the rendered document, with `prosemirror-search`. Its `plugins` go in the
 * editor's state; every state created with them starts with the current query.
 */
export class DocumentFind implements FindTarget {
  readonly #view: FindView;
  /** The query, in an object the search plugin reads when a state is created. */
  readonly #current = { query: none };
  #listener: (() => void) | null = null;
  readonly plugins: readonly Plugin[];

  constructor(view: FindView) {
    this.#view = view;
    const current = this.#current;
    this.plugins = [
      search({
        get initialQuery() {
          return current.query;
        },
      }),
      new Plugin({ view: () => ({ update: () => this.#listener?.() }) }),
    ];
  }

  setQuery(query: FindQuery | null, select: boolean): void {
    const next = query ? new SearchQuery(searchFor(query)) : none;
    this.#current.query = next;
    const state = this.#view.state();
    const tr = setSearchState(state.tr, next);
    const match = select && next.valid ? this.#first(state) : null;
    if (match) tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
    this.#view.dispatch(tr);
  }

  matches(): { current: number; total: number } {
    const state = this.#view.state();
    const found = getMatchHighlights(state).find();
    const { from, to } = state.selection;
    return { current: found.findIndex((d) => d.from === from && d.to === to) + 1, total: found.length };
  }

  findNext(): void {
    this.#run(findNext);
  }

  findPrevious(): void {
    this.#run(findPrev);
  }

  replace(): void {
    this.#run(replaceNext);
  }

  replaceAll(): void {
    this.#run(replaceAll);
  }

  selectedText(): string {
    const { from, to, $from, $to } = this.#view.state().selection;
    const text = this.#view.state().doc.textBetween(from, to, "\n", leaf);
    if (text.includes(leaf)) return "";
    if ($from.sameParent($to) && $from.parent.isTextblock && !$from.parent.type.spec.code)
      return text.replace(/\n/g, " ");
    return text.includes("\n") ? "" : text;
  }

  onUpdate(listener: (() => void) | null): void {
    this.#listener = listener;
  }

  focus(): void {
    this.#view.focus();
  }

  /** The first match at or after the selection's start, wrapping round to the document's start. */
  #first(state: EditorState) {
    const { query } = this.#current;
    return query.findNext(state, state.selection.from) ?? query.findNext(state, 0);
  }

  /** Runs `command`; a change it makes is its own undo step. */
  #run(command: Command): void {
    command(this.#view.state(), (tr) => {
      this.#view.dispatch(tr.docChanged ? closeHistory(tr).setMeta("uiEvent", "find") : tr);
    });
  }
}

/** The marks every text node from `from` to `to` has. */
function marksAcross(doc: Node, from: number, to: number): readonly Mark[] {
  const each: (readonly Mark[])[] = [];
  doc.nodesBetween(from, to, (node) => {
    if (node.isText) each.push(node.marks);
  });
  return each.reduce((common, marks) => common.filter((m) => m.isInSet(marks)), each[0] ?? []);
}

/**
 * Replaces `match`, found in `state`, in `tr`, which has changed nothing before the end of the
 * match. The new text takes the marks the whole match has, a link's included.
 */
function replaceMatch(tr: Transaction, state: EditorState, query: SearchQuery, match: SearchResult): void {
  const marks = marksAcross(state.doc, match.from, match.to);
  const replacements = query.getReplacements(state, match);
  for (let k = replacements.length - 1; k >= 0; k--) {
    const { from, to, insert } = replacements[k]!;
    tr.replace(from, to, insert);
    for (const mark of marks) tr.addMark(from, from + insert.size, mark);
  }
}

/** Replaces the selected match and selects the next one, wrapping round; selects the next match when none is selected. */
const replaceNext: Command = (state, dispatch) => {
  const query = getSearchState(state)?.query;
  if (!query?.valid) return false;
  const { from, to } = state.selection;
  const next = query.findNext(state, from) ?? query.findNext(state, 0);
  if (!next) return false;
  if (!dispatch) return true;
  if (next.from !== from || next.to !== to) {
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, next.from, next.to)).scrollIntoView());
    return true;
  }
  const tr = state.tr;
  replaceMatch(tr, state, query, next);
  const after = query.findNext(state, next.to) ?? query.findNext(state, 0, next.from);
  const selection = after
    ? TextSelection.create(tr.doc, tr.mapping.map(after.from, 1), tr.mapping.map(after.to, -1))
    : TextSelection.create(tr.doc, tr.mapping.map(next.to));
  dispatch(tr.setSelection(selection).scrollIntoView());
  return true;
};

/** Replaces every match. */
const replaceAll: Command = (state, dispatch) => {
  const query = getSearchState(state)?.query;
  if (!query?.valid) return false;
  const matches: SearchResult[] = [];
  for (let next = query.findNext(state); next; next = query.findNext(state, next.to)) matches.push(next);
  if (matches.length === 0) return false;
  if (dispatch) {
    const tr = state.tr;
    for (let k = matches.length - 1; k >= 0; k--) replaceMatch(tr, state, query, matches[k]!);
    dispatch(tr);
  }
  return true;
};
