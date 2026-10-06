import { byteOrderMark } from "../text/byte-order-mark.ts";
import type { Node } from "prosemirror-model";
import { parseMarkdown } from "./parse.ts";
import type { MarkdownSource } from "./source.ts";

/** True when two documents are equal, ignoring how a reference link is written (shortcut, collapsed or full). */
export function sameDocument(a: Node, b: Node): boolean {
  if (a === b) return true;
  const drop = (key: string, value: unknown) => (key === "referenceType" ? undefined : value);
  return JSON.stringify(a.toJSON(), drop) === JSON.stringify(b.toJSON(), drop);
}

/** True when `output` parses back to `doc`. Re-parses only the changed region where that gives the same answer. */
export function verify(source: MarkdownSource, doc: Node, output: string): boolean {
  const region = verifyRegion(source, doc, output);
  return region ?? verifyWhole(doc, output);
}

/** Re-parses the whole output. */
export function verifyWhole(doc: Node, output: string): boolean {
  return sameDocument(parseMarkdown(output).doc, doc);
}

/**
 * Re-parses the top-level blocks whose text changed, one neighbour on each side, followed by
 * every definition in the document so that references resolve. Returns null when the region
 * cannot stand in for the whole document: definitions were added, removed or changed, or a
 * definition spans several lines inside a container.
 */
export function verifyRegion(source: MarkdownSource, doc: Node, output: string): boolean | null {
  const old = source.text;
  const text = source.bom ? output.slice(byteOrderMark.length) : output;
  if (text === old) return sameDocument(source.doc, doc);

  const definitions = definitionSources(doc);
  const oldDefinitions = definitionSources(source.doc);
  if (definitions === null || oldDefinitions === null) return null;
  if (definitions.join("\u0000") !== oldDefinitions.join("\u0000")) return null;

  let prefix = 0;
  const limit = Math.min(old.length, text.length);
  while (prefix < limit && old[prefix] === text[prefix]) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && old[old.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;

  const before = source.doc;
  const n = before.childCount;
  const m = doc.childCount;
  if (n === 0) return null;
  const span = (k: number) => source.ranges.get(before.child(k))!;

  let a = 0;
  while (a < n - 1 && span(a).end < prefix) a++;
  a = Math.max(0, a - 1);
  let b = n - 1;
  while (b > 0 && span(b).start > old.length - suffix) b--;
  b = Math.min(n - 1, b + 1);
  const keptAfter = n - 1 - b;
  if (a + keptAfter > m) return null;
  for (let k = 0; k < a; k++) if (!before.child(k).eq(doc.child(k))) return null;
  for (let k = 0; k < keptAfter; k++) if (!before.child(n - 1 - k).eq(doc.child(m - 1 - k))) return null;

  const start = lineStart(old, Math.min(span(a).start, prefix));
  const end = Math.max(span(b).end, old.length - suffix);
  const delta = text.length - old.length;
  const region = text.slice(start, end + delta);
  // A leading paragraph keeps syntax that only applies at the start of a file (front matter) from applying.
  const lead = start > 0 ? "x" + source.eol + source.eol : "";
  const tail = definitions.length > 0 ? source.eol + source.eol + definitions.join(source.eol + source.eol) : "";
  const parsed = parseMarkdown(lead + region + tail).doc;
  const skip = lead ? 1 : 0;

  const expected: Node[] = [];
  for (let k = a; k < m - keptAfter; k++) expected.push(doc.child(k));
  if (parsed.childCount !== skip + expected.length + definitions.length) return null;
  if (skip && parsed.child(0).textContent !== "x") return null;
  for (let k = 0; k < definitions.length; k++) {
    const extra = parsed.child(skip + expected.length + k);
    if (extra.type.name !== "raw_block" || extra.attrs["source"] !== definitions[k]) return null;
  }
  return expected.every((node, k) => sameDocument(parsed.child(skip + k), node));
}

/** Sources of every link and footnote definition, in document order; null if one cannot be moved to the top level. */
function definitionSources(doc: Node): string[] | null {
  const out: string[] = [];
  const unmovable: string[] = [];
  doc.descendants((node, _pos, parent) => {
    if (node.type.name !== "raw_block") return true;
    const kind = node.attrs["kind"] as string;
    if (kind !== "definition" && kind !== "footnoteDefinition") return false;
    const value = node.attrs["source"] as string;
    (parent !== doc && value.includes("\n") ? unmovable : out).push(value);
    return false;
  });
  return unmovable.length > 0 ? null : out;
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}
