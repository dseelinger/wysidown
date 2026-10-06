import { Transform } from "prosemirror-transform";
import type { Node as PMNode } from "prosemirror-model";
import { schema } from "./schema.ts";
import { parse, type Parsed } from "./parse.ts";
import { serialize, serializeVerified, sameDoc } from "./serialize.ts";
import { canonicalDoc } from "./canonical.ts";

export interface Result {
  total: number;
  pass: number;
  failures: string[];
}

const fresh = (): Result => ({ total: 0, pass: 0, failures: [] });

/** Identity with every container walked, so gaps and child ranges must reassemble the source exactly. */
export function identity(input: string): boolean {
  const p = parse(input);
  return serialize(p, p.doc, { forceDescend: true }) === input;
}

function textblocks(doc: PMNode): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && node.type.name !== "code_block") out.push({ node, pos });
    return !node.isTextblock;
  });
  return out;
}

const bomLen = (p: Parsed) => (p.bom ? 1 : 0);

/** Replaces the first 3+ letter word of each textblock; expects exactly that word's bytes to change. */
export function wordEdits(input: string, replacement = "EDITED"): Result {
  const r = fresh();
  const p = parse(input);
  for (const { node, pos } of textblocks(p.doc)) {
    const map = p.chars.get(node)!;
    let offset = 0;
    let found: { from: number; to: number; marks: PMNode["marks"] } | null = null;
    node.forEach((child) => {
      if (found) return;
      if (child.isText) {
        const m = /[A-Za-z]{3,}/.exec(child.text!);
        if (m) found = { from: offset + m.index, to: offset + m.index + m[0].length, marks: child.marks };
      }
      offset += child.nodeSize;
    });
    if (!found) continue;
    const f = found as { from: number; to: number; marks: PMNode["marks"] };
    if (map.seg[f.from]! < 0) continue;
    r.total++;
    const tr = new Transform(p.doc).replaceWith(pos + 1 + f.from, pos + 1 + f.to, schema.text(replacement, f.marks));
    const { out, verified } = serializeVerified(p, tr.doc);
    const s = map.start[f.from]! + bomLen(p);
    const e = map.end[f.to - 1]! + bomLen(p);
    const expected = input.slice(0, s) + replacement + input.slice(e);
    const block = p.ranges.get(node)!;
    const bs = block.start + bomLen(p);
    const be = block.end + bomLen(p);
    const ok = /^[A-Za-z]+$/.test(replacement)
      ? out === expected
      : out.slice(0, bs) === input.slice(0, bs) && out.endsWith(input.slice(be));
    if (verified && ok) r.pass++;
    else r.failures.push(`word@${pos}: ${JSON.stringify(input.slice(s, e))} ${why(verified, p, tr.doc)}`);
  }
  return r;
}

/** Makes the first word of each top-level block bold; expects every byte outside that block unchanged. */
export function markEdits(input: string): Result {
  const r = fresh();
  const p = parse(input);
  p.doc.forEach((block, blockPos) => {
    let target: { from: number; to: number } | null = null;
    block.descendants((node, at) => {
      if (target) return false;
      if (!node.isText) return true;
      if (node.marks.some((k) => k.type.name === "code" || k.type.name === "strong")) return false;
      const m = /[A-Za-z]{3,}/.exec(node.text!);
      if (m) target = { from: blockPos + 1 + at + m.index, to: blockPos + 1 + at + m.index + m[0].length };
      return false;
    });
    if (!target) return;
    const t = target as { from: number; to: number };
    r.total++;
    const tr = new Transform(p.doc).addMark(t.from, t.to, schema.marks.strong!.create());
    const { out, verified } = serializeVerified(p, tr.doc);
    const range = p.ranges.get(block)!;
    const s = range.start + bomLen(p);
    const e = range.end + bomLen(p);
    if (verified && out.slice(0, s) === input.slice(0, s) && out.endsWith(input.slice(e))) r.pass++;
    else r.failures.push(`bold@${blockPos} ${block.type.name}: ${why(verified, p, tr.doc)}`);
  });
  return r;
}

/** Inserts a paragraph after each top-level block; expects the bytes before and after the insertion point unchanged. */
export function insertEdits(input: string): Result {
  const r = fresh();
  const p = parse(input);
  p.doc.forEach((block, pos) => {
    r.total++;
    const at = pos + block.nodeSize;
    const tr = new Transform(p.doc).insert(at, schema.nodes.paragraph!.create(null, schema.text("Inserted paragraph.")));
    const { out, verified } = serializeVerified(p, tr.doc);
    const end = p.ranges.get(block)!.end + bomLen(p);
    const rest = input.slice(end).replace(/^(\r?\n)+/, "");
    if (verified && out.slice(0, end) === input.slice(0, end) && out.endsWith(rest)) r.pass++;
    else r.failures.push(`insert@${pos} after ${block.type.name}: ${why(verified, p, tr.doc)}`);
  });
  return r;
}

/** Deletes each top-level block; expects the bytes before and after it unchanged. */
export function deleteEdits(input: string): Result {
  const r = fresh();
  const p = parse(input);
  if (p.doc.childCount < 2) return r;
  p.doc.forEach((block, pos) => {
    r.total++;
    const tr = new Transform(p.doc).delete(pos, pos + block.nodeSize);
    const { out, verified } = serializeVerified(p, tr.doc);
    const range = p.ranges.get(block)!;
    const s = range.start + bomLen(p);
    const e = range.end + bomLen(p);
    const before = input.slice(0, s).replace(/\s+$/, "");
    const after = input.slice(e).replace(/^\s+/, "");
    if (verified && out.startsWith(before) && out.endsWith(after)) r.pass++;
    else r.failures.push(`delete@${pos} ${block.type.name}: ${why(verified, p, tr.doc)}`);
  });
  return r;
}

/** Toggles every task-list checkbox; expects exactly one character to change. */
export function taskToggles(input: string): Result {
  const r = fresh();
  const p = parse(input);
  p.doc.descendants((node, pos) => {
    if (node.type.name !== "list_item" || node.attrs.checked === null) return true;
    r.total++;
    const tr = new Transform(p.doc).setNodeMarkup(pos, null, { ...node.attrs, checked: !node.attrs.checked });
    const { out, verified } = serializeVerified(p, tr.doc);
    let diffs = 0;
    for (let k = 0; k < Math.max(out.length, input.length); k++) if (out[k] !== input[k]) diffs++;
    if (verified && out.length === input.length && diffs === 1) r.pass++;
    else r.failures.push(`toggle@${pos}: ${why(verified, p, tr.doc)} diffs=${diffs}`);
    return true;
  });
  return r;
}

/** Labels a failure: the splice verified but changed too much, markdown cannot express the edit, or the serializer is wrong. */
function why(verified: boolean, p: Parsed, doc: PMNode): string {
  if (verified) return "too-wide";
  try {
    return sameDoc(parse(canonicalDoc(doc, p.style)).doc, doc) ? "serializer" : "inherent";
  } catch {
    return "inherent";
  }
}
