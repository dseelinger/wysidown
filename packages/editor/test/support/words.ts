import type { MarkdownSource } from "@wysidown/core";
import type { Mark } from "prosemirror-model";

export interface WordEnd {
  /** Document position just after the word. */
  pos: number;
  /** Offset in the file text just after the word, byte order mark included. */
  offset: number;
  marks: readonly Mark[];
  /** Index of the top-level block holding the word. */
  block: number;
}

/**
 * The end of the first word of three or more letters, outside code, whose text maps to the
 * source; null when there is none. Skips the top-level block `skip`.
 */
export function wordEnd(source: MarkdownSource, skip = -1): WordEnd | null {
  let found: WordEnd | null = null;
  source.doc.forEach((top, topPos, block) => {
    if (found || block === skip) return;
    const visit = (node: typeof top, pos: number) => {
      if (found) return;
      if (node.isTextblock) {
        if (node.type.name === "code_block") return;
        const map = source.chars.get(node);
        let offset = 0;
        node.forEach((child) => {
          const m = !found && child.isText ? /[A-Za-z]{3,}/.exec(child.text!) : null;
          const last = m ? offset + m.index + m[0].length - 1 : -1;
          if (m && map && map.run[last]! >= 0) {
            found = {
              pos: pos + 1 + last + 1,
              offset: map.end[last]! + (source.bom ? 1 : 0),
              marks: child.marks,
              block,
            };
          }
          offset += child.nodeSize;
        });
        return;
      }
      node.forEach((child, childOffset) => {
        visit(child, pos + 1 + childOffset);
      });
    };
    visit(top, topPos);
  });
  return found;
}
