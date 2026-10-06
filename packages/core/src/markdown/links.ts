import { toMarkdown } from "mdast-util-to-markdown";
import { parseMdast } from "./parse.ts";

/** A link's target and title. */
export interface LinkTarget {
  href: string;
  title: string | null;
}

/** The target of a link definition's source; null when the source is not one link definition. */
export function definitionTarget(source: string): LinkTarget | null {
  const root = parseMdast(source.replace(/^[ \t>]*/gm, ""));
  const only = root.children.length === 1 ? root.children[0]! : null;
  return only?.type === "definition" ? { href: only.url, title: only.title ?? null } : null;
}

const definitionHead = /^[ \t]*\[(?:\\[^]|[^\\\]])*\]:[ \t]*(?:\r?\n[ \t>]*)?/;

/**
 * A link definition's source with its destination replaced by `href`, keeping the label, the
 * spacing and the title as written. Null when `source` is not one link definition.
 */
export function retargetDefinition(source: string, href: string): string | null {
  const was = definitionTarget(source);
  const head = definitionHead.exec(source)?.[0];
  if (!was || head === undefined) return null;
  const rest = source.slice(head.length);
  const old = rest.startsWith("<") ? /^<(?:\\[^]|[^\\<>\n])*>/.exec(rest)?.[0] : /^\S*/.exec(rest)![0];
  if (old === undefined) return null;
  const written = toMarkdown({ type: "definition", identifier: "x", label: "x", url: href, title: null });
  const destination = written.replace(/^\[x\]: /, "").replace(/\n$/, "");
  const now = head + destination + rest.slice(old.length);
  const target = definitionTarget(now);
  return target?.href === href && target.title === was.title ? now : null;
}
