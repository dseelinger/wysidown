import type * as M from "mdast";
import type { Style } from "./source.ts";

/** The markers the document uses most, for writing new or rewritten blocks in the same style. */
export function detectStyle(source: string, root: M.Root): Style {
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  const walk = (node: M.Node) => {
    const first = node.position ? source[node.position.start.offset!] : undefined;
    if (first !== undefined) {
      if (node.type === "list" && !(node as M.List).ordered) bump("bullet" + first);
      else if (node.type === "emphasis") bump("emphasis" + first);
      else if (node.type === "strong") bump("strong" + first);
      else if (node.type === "code") bump("fence" + first);
      else if (node.type === "thematicBreak") bump("rule" + first);
    }
    if ("children" in node) for (const child of (node as M.Parent).children) walk(child);
  };
  walk(root);
  const pick = <T extends string>(kind: string, options: readonly T[], fallback: T): T => {
    let best = fallback;
    let most = 0;
    for (const option of options) {
      const n = counts.get(kind + option) ?? 0;
      if (n > most) {
        best = option;
        most = n;
      }
    }
    return best;
  };
  return {
    bullet: pick("bullet", ["-", "*", "+"], "-"),
    emphasis: pick("emphasis", ["*", "_"], "*"),
    strong: pick("strong", ["*", "_"], "*"),
    fence: pick("fence", ["`", "~"], "`"),
    rule: pick("rule", ["-", "*", "_"], "-"),
  };
}
