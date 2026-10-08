import { schema } from "@wysidown/core";
import { InputRule, inputRules, undoInputRule } from "prosemirror-inputrules";
import type { Attrs, MarkType, Node, NodeType, ResolvedPos } from "prosemirror-model";
import { Plugin, PluginKey, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { typing } from "./session.ts";

const { paragraph, heading, list, list_item: item, blockquote, code_block: codeBlock } = schema.nodes;
const marks = schema.marks;

/** An input rule that does not apply where the typed text would be inline code, or after inline code in the match. */
function rule(
  match: RegExp,
  handler: (state: EditorState, match: RegExpMatchArray, start: number, end: number) => Transaction | null,
): InputRule {
  return new InputRule(match, (state, m, start, end) => {
    let code = marks.code.isInSet(state.storedMarks ?? state.selection.$from.marks()) !== undefined;
    state.doc.nodesBetween(start, end, (node) => {
      code ||= marks.code.isInSet(node.marks) !== undefined;
    });
    return code ? null : handler(state, m, start, end);
  });
}

/** True at the start of the first block of a task item, where the task's checkbox is written. */
function startsTask($pos: ResolvedPos): boolean {
  return (
    $pos.depth > 1 && $pos.index(-1) === 0 && $pos.node(-1).type === item && $pos.node(-1).attrs["checked"] !== null
  );
}

/**
 * A rule for syntax typed at the start of a paragraph. `convert` gets the transaction with the
 * typed syntax deleted and the start of the paragraph's content, and returns false to leave it.
 */
function atStart(
  match: RegExp,
  convert: (tr: Transaction, $start: ResolvedPos, match: RegExpMatchArray) => boolean,
): InputRule {
  return rule(match, (state, m, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.parent.type !== paragraph || $start.parentOffset !== 0 || startsTask($start)) return null;
    const tr = state.tr.delete(start, end);
    return convert(tr, tr.doc.resolve(start), m) ? tr : null;
  });
}

/**
 * Wraps the paragraph at `$start` in `type`, with a list item inside when `type` is a list. A new
 * list joins a list of the same kind straight before or after it, as markdown would read them.
 */
function wrap(type: NodeType, attrs: Attrs | null) {
  return (tr: Transaction, $start: ResolvedPos): boolean => {
    const range = $start.blockRange();
    if (!range) return false;
    tr.wrap(range, [{ type, attrs }, ...(type === list ? [{ type: item, attrs: null }] : [])]);
    if (type !== list) return true;
    const sameKind = (node: Node | null | undefined) =>
      node?.type === list && node.attrs["ordered"] === attrs?.["ordered"];
    const at = range.start;
    const end = at + tr.doc.nodeAt(at)!.nodeSize;
    const after = tr.doc.resolve(end).nodeAfter;
    if (sameKind(after))
      tr.join(end).setNodeMarkup(at, null, { ...after!.attrs, start: attrs?.["start"] as number | null });
    if (sameKind(tr.doc.resolve(at).nodeBefore)) tr.join(at);
    return true;
  };
}

/**
 * A rule for the closing marker typed after text that opened with the same marker, `length`
 * characters long: the text between, group 1 of `match`, takes `mark`.
 */
function around(match: RegExp, length: number, mark: MarkType): InputRule {
  return rule(match, (state, m, start, end) => {
    const from = start + length;
    const to = from + m[1]!.length;
    return state.tr.delete(to, end).addMark(from, to, mark.create()).delete(start, from).removeStoredMark(mark);
  });
}

/** Makes the first paragraph of a plain list item a task, when `[ ] ` or `[x] ` starts it. */
const task = rule(/^\[([ xX])\] $/, (state, m, start, end) => {
  const $start = state.doc.resolve(start);
  if ($start.parent.type !== paragraph || $start.parentOffset !== 0 || $start.index(-1) !== 0) return null;
  const holder = $start.node(-1);
  if (holder.type !== item || holder.attrs["checked"] !== null) return null;
  return state.tr.delete(start, end).setNodeMarkup($start.before(-1), null, { ...holder.attrs, checked: m[1] !== " " });
});

/** The rules that turn markdown syntax typed into the editor into formatting. */
const rules = [
  atStart(/^(#{1,6}) $/, (tr, $start, m) => {
    tr.setBlockType($start.pos, $start.pos, heading, { level: m[1]!.length });
    return true;
  }),
  atStart(/^[-+*] $/, (tr, $start) => wrap(list, { ordered: false, start: null })(tr, $start)),
  atStart(/^(\d{1,9})[.)] $/, (tr, $start, m) => wrap(list, { ordered: true, start: Number(m[1]) })(tr, $start)),
  atStart(/^> $/, wrap(blockquote, null)),
  task,
  // Text between markers neither starts nor ends with a space; `_` does not open inside a word.
  around(/(?<!\*)\*\*([^*\s\ufffc](?:[^*\ufffc]*[^*\s\ufffc])?)\*\*$/u, 2, marks.strong),
  around(/(?<![\p{L}\p{N}_])__([^_\s\ufffc](?:[^_\ufffc]*[^_\s\ufffc])?)__$/u, 2, marks.strong),
  around(/(?<!\*)\*([^*\s\ufffc](?:[^*\ufffc]*[^*\s\ufffc])?)\*$/u, 1, marks.em),
  around(/(?<![\p{L}\p{N}_])_([^_\s\ufffc](?:[^_\ufffc]*[^_\s\ufffc])?)_$/u, 1, marks.em),
  around(/(?<!~)~~([^~\s\ufffc](?:[^~\ufffc]*[^~\s\ufffc])?)~~$/u, 2, marks.strike),
  around(/(?<!`)`((?=[^`]*[^`\s])[^`\ufffc]+)`$/u, 1, marks.code),
];

/** Turns markdown syntax typed at the start of a block or around text into formatting. */
export const typedSyntax: Plugin = inputRules({ rules });

const fence = /^(?:```|~~~)(?![`~])[ \t]*([^\s`]+)?(?:[ \t]+([^\s`][^`]*?))?[ \t]*$/;
const thematicBreak = /^(?:---|\*\*\*|___)$/;

const typedLine = new PluginKey<number | null>("typedLine");

/** Tracks the start of the textblock the last transaction typed into; null after anything else. */
const lineTyping = new Plugin<number | null>({
  key: typedLine,
  state: {
    init: () => null,
    apply: (tr, previous) =>
      typing(tr) ? tr.selection.$from.start() : tr.docChanged || tr.selectionSet ? null : previous,
  },
});

/** The plugins `convertLine` and the typed-syntax rules need. */
export const typedSyntaxPlugins: Plugin[] = [typedSyntax, lineTyping];

/**
 * Enter at the end of a paragraph that holds only a code fence, with an optional language, or a
 * thematic break turns it into that block, when the line was typed just before. Backspace straight
 * after undoes it, as it does a rule. A rule is not made on the first line of a list item, where
 * `- ---` would read as a rule alone.
 */
export const convertLine: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const block = $from.parent;
  if (!empty || block.type !== paragraph || $from.parentOffset !== block.content.size) return false;
  if (typedLine.getState(state) !== $from.start()) return false;
  if (block.childCount !== 1 || !block.firstChild!.isText || block.firstChild!.marks.length > 0) return false;
  if (startsTask($from)) return false;
  const line = block.textContent;
  const opened = fence.exec(line);
  const firstInItem = $from.depth > 1 && $from.index(-1) === 0 && $from.node(-1).type === item;
  if (!opened && (firstInItem || !thematicBreak.test(line))) return false;
  if (dispatch) {
    const start = $from.start();
    const tr = state.tr.delete(start, $from.pos);
    if (opened) tr.setBlockType(start, start, codeBlock, { lang: opened[1] ?? null, meta: opened[2] ?? null });
    else tr.insert($from.before(), schema.nodes.thematic_break.create());
    dispatch(tr.setMeta(typedSyntax, { transform: tr, from: $from.pos, to: $from.pos, text: "" }));
  }
  return true;
};

/** Undoes the conversion just made, leaving the syntax as it was typed. */
export const undoConversion: Command = undoInputRule;

export const typedSyntaxKeys: Record<string, Command> = { Enter: convertLine, Backspace: undoConversion };
