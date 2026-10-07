import { DocumentFind } from "../../src/document-find.ts";
import type { FindQuery } from "../../src/find.ts";
import { Wire } from "./wire.ts";

/** A wire whose state carries the document's find, and the find that acts on it. */
export function findIn(text: string): { wire: Wire; find: DocumentFind } {
  const holder: { wire?: Wire } = {};
  const wire = (): Wire => holder.wire!;
  const find = new DocumentFind({
    state: () => wire().state,
    dispatch: (tr) => {
      wire().session.update(wire().state.apply(tr), tr);
    },
    focus: () => undefined,
  });
  holder.wire = new Wire(text, 0, find.plugins);
  return { wire: holder.wire, find };
}

/** A query for `search` with every option off, and the options in `options`. */
export function query(search: string, options: Partial<FindQuery> = {}): FindQuery {
  return { search, replace: "", caseSensitive: false, wholeWord: false, regexp: false, ...options };
}
