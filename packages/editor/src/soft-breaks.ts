import type { Node, ResolvedPos } from "prosemirror-model";
import { keydownHandler } from "prosemirror-keymap";
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";
import { Decoration, DecorationSet } from "prosemirror-view";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const cache = new WeakMap<Node, number[]>();

const shown = new WeakMap<Node, DecorationSet>();

/** The offsets of the soft line breaks in a textblock's content. */
function breaksOf(block: Node): number[] {
  const known = cache.get(block);
  if (known) return known;
  const offsets: number[] = [];
  block.forEach((child, offset) => {
    const text = child.text;
    if (text === undefined) return;
    for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) offsets.push(offset + i);
  });
  cache.set(block, offsets);
  return offsets;
}

/** True when the selection is in one textblock outside code and touches or holds a soft line break. */
function atSoftBreak(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  const block = $from.parent;
  if (!block.isTextblock || block.type.spec.code || !$from.sameParent($to)) return false;
  const from = Math.max($from.parentOffset - 1, 0);
  const to = Math.min($to.parentOffset + 1, block.content.size);
  return breaksOf(block).some((offset) => offset >= from && offset < to);
}

/** True when the selection's head is in a textblock outside code, next to a soft line break. */
function headAtSoftBreak(state: EditorState): boolean {
  const { $head } = state.selection;
  if ($head.parent.type.spec.code) return false;
  const breaks = breaksOf($head.parent);
  return breaks.includes($head.parentOffset - 1) || breaks.includes($head.parentOffset);
}

/** The size of the character or inline node `dir` from `$pos` in its textblock; 0 at its edge. */
function besideSize($pos: ResolvedPos, dir: 1 | -1): number {
  const beside = dir < 0 ? $pos.nodeBefore : $pos.nodeAfter;
  if (!beside) return 0;
  const text = beside.text;
  if (text === undefined) return beside.nodeSize;
  return graphemes.segment(text).containing(dir < 0 ? text.length - 1 : 0)?.segment.length ?? 1;
}

/**
 * Moves the caret, or with `extend` the selection's head, one character from a head next to a
 * soft line break.
 */
function step(dir: 1 | -1, extend: boolean): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!(sel instanceof TextSelection) || (!sel.empty && !extend) || !headAtSoftBreak(state)) return false;
    const size = besideSize(sel.$head, dir);
    if (size === 0) return false;
    const head = sel.head + dir * size;
    const next = extend ? TextSelection.create(state.doc, sel.anchor, head) : TextSelection.create(state.doc, head);
    dispatch?.(state.tr.setSelection(next).scrollIntoView());
    return true;
  };
}

/**
 * Deletes a selection that touches or holds a soft line break, or the character or inline node
 * `dir` from a caret next to one.
 */
function deleteAt(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!atSoftBreak(state)) return false;
    if (!sel.empty) {
      dispatch?.(state.tr.deleteSelection().scrollIntoView());
      return true;
    }
    const size = besideSize(sel.$head, dir);
    if (size === 0) return false;
    const from = dir < 0 ? sel.head - size : sel.head;
    dispatch?.(state.tr.delete(from, from + size).scrollIntoView());
    return true;
  };
}

const space = /^[ \u00a0]$/;

/**
 * The positions in `tr.doc` of the spaces or no-break spaces the browser wrote in place of soft
 * line breaks in the one textblock `tr` changed.
 */
function rewrittenBreaks(tr: Transaction): number[] {
  const step = tr.steps[0];
  if (tr.steps.length !== 1 || !(step instanceof ReplaceStep)) return [];
  const $from = tr.before.resolve(step.from);
  if ($from.parent.type.spec.code || !$from.sameParent(tr.before.resolve(step.to))) return [];
  const before = tr.before.textBetween(step.from, step.to, undefined, "\ufffc");
  const after = step.slice.content.textBetween(0, step.slice.content.size, undefined, "\ufffc");
  const found: number[] = [];
  for (let k = before.indexOf("\n"); k >= 0; k = before.indexOf("\n", k + 1)) {
    const j = after.length - (before.length - k);
    if (space.test(after.charAt(k)) && before.slice(0, k) === after.slice(0, k)) found.push(step.from + k);
    else if (space.test(after.charAt(j)) && before.slice(k + 1) === after.slice(j + 1)) found.push(step.from + j);
  }
  return found;
}

const keys = keydownHandler({
  Backspace: deleteAt(-1),
  Delete: deleteAt(1),
  ArrowLeft: step(-1, false),
  ArrowRight: step(1, false),
  "Shift-ArrowLeft": step(-1, true),
  "Shift-ArrowRight": step(1, true),
});

/**
 * Shows each soft line break outside code as a space: the stylesheet collapses the `\n` inside
 * the class `soft-break`. The document keeps the `\n`. The browser rewrites a collapsed `\n` it
 * edits next to and does not move the caret next to one reliably, so typing, deleting and the
 * arrow keys next to a soft line break are handled here, and a soft line break that composed text
 * replaced with a space is put back.
 */
export function softBreaks(): Plugin {
  const key = new PluginKey<number[]>("softBreaks");
  return new Plugin({
    key,
    /** The positions of soft line breaks the browser rewrote during the current composition. */
    state: {
      init: (): number[] => [],
      apply(tr, rewritten) {
        if (tr.getMeta(key) === "restored") return [];
        const mapped = rewritten.map((pos) => tr.mapping.map(pos, -1));
        return tr.getMeta("composition") === undefined ? mapped : [...mapped, ...rewrittenBreaks(tr)];
      },
    },
    view() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return {
        update(view) {
          if (view.composing || key.getState(view.state)?.length === 0 || timer !== undefined) return;
          timer = setTimeout(() => {
            timer = undefined;
            const { state } = view;
            if (view.composing) return;
            const tr = state.tr.setMeta(key, "restored");
            for (const pos of key.getState(state) ?? []) {
              if (space.test(state.doc.textBetween(pos, Math.min(pos + 1, state.doc.content.size)))) {
                tr.insertText("\n", pos, pos + 1);
              }
            }
            view.dispatch(tr);
          });
        },
        destroy() {
          clearTimeout(timer);
        },
      };
    },
    props: {
      decorations(state) {
        const known = shown.get(state.doc);
        if (known) return known;
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (!node.isTextblock) return node.isBlock;
          if (node.type.spec.code) return false;
          for (const offset of breaksOf(node)) {
            decorations.push(Decoration.inline(pos + 1 + offset, pos + 2 + offset, { class: "soft-break" }));
          }
          return false;
        });
        const set = DecorationSet.create(state.doc, decorations);
        shown.set(state.doc, set);
        return set;
      },
      handleKeyDown: keys,
      handleDOMEvents: {
        beforeinput(view, event) {
          const text = event.inputType === "insertText" ? event.data : null;
          if (text === null || view.composing || !atSoftBreak(view.state)) return false;
          event.preventDefault();
          view.dispatch(view.state.tr.insertText(text).scrollIntoView());
          return true;
        },
      },
    },
  });
}
