import type { Command, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { typedSyntax } from "../../src/typed-syntax.ts";
import type { Wire } from "./wire.ts";

/** Types `text` a character at a time, each through the typed-syntax rules as the view passes it. */
export function type(wire: Wire, text: string): void {
  const view = {
    composing: false,
    get state() {
      return wire.state;
    },
    dispatch(tr: Transaction) {
      wire.session.update(wire.state.apply(tr), tr);
    },
  } as unknown as EditorView;
  for (const ch of text) {
    const { from, to } = wire.state.selection;
    const insert = () => wire.state.tr.insertText(ch, from, to);
    if (!typedSyntax.props.handleTextInput?.call(typedSyntax, view, from, to, ch, insert)) wire.edit(insert);
  }
}

/** Runs `command` as a key press would; returns whether it applied. */
export function press(wire: Wire, command: Command): boolean {
  return command(wire.state, (tr) => {
    wire.session.update(wire.state.apply(tr), tr);
  });
}
