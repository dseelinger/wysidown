import type { Mark, Node as PMNode } from "prosemirror-model";
import { schema } from "./schema.ts";
import { canonical, canonicalDoc } from "./canonical.ts";
import { parse, type Parsed } from "./parse.ts";

export interface Options {
  /** Descend into unchanged containers instead of copying them whole. */
  forceDescend?: boolean;
  /** Re-serialize edited textblocks instead of splicing the edit into their source. */
  noInlineSplice?: boolean;
  /** Re-serialize a whole edited textblock instead of only its inline content. */
  noReinline?: boolean;
  /** Re-serialize an inserted or deleted region together with its neighbours. */
  widen?: boolean;
}

export interface Stats {
  spliced: number;
  canonical: number;
}

export function serialize(p: Parsed, doc: PMNode, opts: Options = {}, stats: Stats = { spliced: 0, canonical: 0 }): string {
  const src = p.source;
  const range = (n: PMNode) => p.ranges.get(n)!;
  const slice = (n: PMNode) => src.slice(range(n).start, range(n).end);

  const indent = (text: string, prefix: string) =>
    text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line, i) => (i === 0 ? line : line === "" ? prefix.trimEnd() : prefix + line))
      .join(p.eol);

  const canon = (n: PMNode, prefix: string, parent: PMNode | null, index: number): string | null => {
    stats.canonical++;
    if (n.type.name === "table_row" || n.type.name === "table_cell") return null;
    if (n.type.name === "list_item" && parent) {
      const start = parent.attrs.ordered ? (parent.attrs.start ?? 1) + index : null;
      const list = schema.nodes.list!.create({ ...parent.attrs, start }, n);
      return indent(canonical(list, p.style), prefix);
    }
    return indent(canonical(n, p.style), prefix);
  };

  const childPrefix = (old: PMNode, prefix: string): string => {
    const r = range(old);
    switch (old.type.name) {
      case "blockquote":
        return prefix + (/^>[ \t]?/.exec(src.slice(r.start))?.[0] ?? "> ");
      case "list_item": {
        const first = old.firstChild ? range(old.firstChild) : null;
        const head = first ? src.slice(r.start, first.start) : "";
        if (!first || head.includes("\n")) {
          const marker = /^(?:[-*+]|\d+[.)])/.exec(src.slice(r.start))?.[0] ?? "-";
          return prefix + " ".repeat(marker.length + 1);
        }
        const box = old.attrs.checked !== null ? (/\[[ xX]\][ \t]*$/.exec(head)?.[0].length ?? 0) : 0;
        return prefix + " ".repeat(head.length - box);
      }
      default:
        return prefix;
    }
  };

  const emit = (old: PMNode, neu: PMNode, prefix: string): string | null => {
    if (old === neu && !(opts.forceDescend && !old.isLeaf && !old.isTextblock)) return slice(old);
    if (old.type !== neu.type) return null;
    if (neu.isTextblock) {
      if (!sameAttrs(old, neu)) return null;
      if (old.eq(neu)) return slice(old);
      return (opts.noInlineSplice ? null : spliceInline(old, neu)) ?? (opts.noReinline ? null : reinline(old, neu, prefix));
    }
    if (neu.isLeaf) return old.eq(neu) ? slice(old) : null;
    let head: ((s: string) => string) | null = null;
    if (!sameAttrs(old, neu)) {
      if (old.type.name !== "list_item" || !sameAttrs(old, neu, ["checked"])) return null;
      if (old.attrs.checked === null || neu.attrs.checked === null) return null;
      head = (s) => s.replace(/\[[ xX]\]/, neu.attrs.checked ? "[x]" : "[ ]");
    }
    return emitChildren(old, neu, childPrefix(old, prefix), head);
  };

  const emitChildren = (
    old: PMNode,
    neu: PMNode,
    prefix: string,
    head: ((s: string) => string) | null,
  ): string | null => {
    const r = range(old);
    const oc = children(old);
    const nc = children(neu);
    const n = oc.length;
    const m = nc.length;
    if (n === 0) return m === 0 ? slice(old) : null;
    const rs = oc.map(range);
    const gaps = [src.slice(r.start, rs[0]!.start)];
    for (let k = 1; k < n; k++) gaps.push(src.slice(rs[k - 1]!.end, rs[k]!.start));
    gaps.push(src.slice(rs[n - 1]!.end, r.end));
    if (head) gaps[0] = head(gaps[0]!);

    const pair = (o: PMNode, nn: PMNode, idx: number) => {
      const e = emit(o, nn, prefix);
      if (e !== null) {
        if (o !== nn) stats.spliced++;
        return e;
      }
      return canon(nn, prefix, neu, idx);
    };

    let i = 0;
    while (i < n && i < m && oc[i] === nc[i]) i++;
    let j = 0;
    while (j < n - i && j < m - i && oc[n - 1 - j] === nc[m - 1 - j]) j++;
    const oMid = n - i - j;
    const nMid = m - i - j;

    if (opts.widen && oMid !== nMid && !["list", "table", "table_row"].includes(old.type.name)) {
      const lo = Math.max(0, i - 1);
      const hiOld = Math.min(n, n - j + 1);
      const hiNew = Math.min(m, m - j + 1);
      const joint = canonicalDoc(schema.nodes.doc!.create(null, nc.slice(lo, hiNew)), p.style).replace(/\n$/, "");
      stats.canonical++;
      let out = gaps[0]!;
      for (let k = 0; k < lo; k++) out += slice(oc[k]!) + gaps[k + 1]!;
      out += indent(joint, prefix);
      for (let k = hiOld; k < n; k++) out += gaps[k]! + slice(oc[k]!);
      return out + gaps[n]!;
    }

    if (oMid === nMid) {
      let out = gaps[0]!;
      for (let k = 0; k < n; k++) {
        const e = pair(oc[k]!, nc[k]!, k);
        if (e === null) return null;
        out += e + gaps[k + 1]!;
      }
      return out;
    }

    const blank = /\n[ \t>]*\r?\n/;
    const sep =
      old.type.name === "list"
        ? (gaps.slice(1, n).find((g) => g.includes("\n")) ?? p.eol + prefix)
        : (gaps.slice(1, n).find((g) => blank.test(g)) ?? p.eol + prefix.trimEnd() + p.eol + prefix);
    const fresh: string[] = [];
    for (let k = i; k < i + nMid; k++) {
      const c = canon(nc[k]!, prefix, neu, k);
      if (c === null) return null;
      fresh.push(c);
    }
    const kept = (k: number) => slice(oc[k]!);
    const around = (g: string) => (old.type.name === "list" || blank.test(g) ? g : sep);
    let out = gaps[0]!;
    if (oMid > 0 && nMid > 0) {
      for (let k = 0; k < i; k++) out += kept(k) + (k + 1 < i ? gaps[k + 1]! : around(gaps[i]!));
      out += fresh.join(sep);
      for (let k = i + oMid; k < n; k++) out += (k === i + oMid ? around(gaps[k]!) : gaps[k]!) + kept(k);
      return out + gaps[n]!;
    }
    if (nMid === 0) {
      if (i === 0 && oMid === n) return null;
      if (i + oMid < n) {
        for (let k = 0; k < i; k++) out += kept(k) + (k + 1 < i ? gaps[k + 1]! : around(joinGaps(gaps[i]!, gaps[i + oMid]!)));
        for (let k = i + oMid; k < n; k++) out += kept(k) + gaps[k + 1]!;
        return out;
      }
      for (let k = 0; k < i; k++) out += kept(k) + (k + 1 < i ? gaps[k + 1]! : "");
      return out + gaps[n]!;
    }
    // Insertion of nMid nodes at index i.
    for (let k = 0; k < i; k++) out += kept(k) + (k + 1 < i ? gaps[k + 1]! : "");
    if (i > 0) out += sep;
    out += fresh.join(sep);
    if (i === n) return out + gaps[n]!;
    out += i > 0 ? around(gaps[i]!) : sep;
    for (let k = i; k < n; k++) out += kept(k) + gaps[k + 1]!;
    return out;
  };

  const spliceInline = (old: PMNode, neu: PMNode): string | null => {
    const map = p.chars.get(old);
    if (!map) return null;
    const a = flatten(old);
    const b = flatten(neu);
    let pre = 0;
    while (pre < a.length && pre < b.length && sameItem(a[pre]!, b[pre]!)) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && sameItem(a[a.length - 1 - suf]!, b[b.length - 1 - suf]!)) suf++;
    const oldMid = a.slice(pre, a.length - suf);
    const newMid = b.slice(pre, b.length - suf);
    if (newMid.some((x) => x.ch === null || x.ch === "\n")) return null;
    const marks = newMid[0]?.marks;
    if (marks && newMid.some((x) => !sameMarks(x.marks, marks))) return null;
    let from: number;
    let to: number;
    if (oldMid.length > 0) {
      const segs = new Set(oldMid.map((_, k) => map.seg[pre + k]));
      if (segs.size !== 1 || segs.has(-1)) return null;
      if (marks && !sameMarks(oldMid[0]!.marks, marks)) return null;
      from = map.start[pre]!;
      to = map.end[a.length - suf - 1]!;
    } else {
      const before = pre > 0 ? a[pre - 1]! : null;
      const after = pre < a.length ? a[pre]! : null;
      if (before && before.ch !== null && map.seg[pre - 1]! >= 0 && sameMarks(before.marks, marks!)) {
        from = to = map.end[pre - 1]!;
      } else if (after && after.ch !== null && map.seg[pre]! >= 0 && sameMarks(after.marks, marks!)) {
        from = to = map.start[pre]!;
      } else return null;
    }
    const r = range(old);
    stats.spliced++;
    return src.slice(r.start, from) + escapeInline(newMid.map((x) => x.ch).join("")) + src.slice(to, r.end);
  };

  /** Re-serializes a textblock's inline content, keeping its own syntax (heading marker, cell pipes) from the source. */
  const reinline = (old: PMNode, neu: PMNode, prefix: string): string | null => {
    const map = p.chars.get(old);
    if (!map) return null;
    const from = map.contentStart;
    const to = map.contentEnd;
    if (from < 0 || to < 0) return null;
    let body = canonical(schema.nodes.paragraph!.create(null, neu.content), p.style);
    if (neu.type.name === "table_cell") body = body.replace(/(^|[^\\])\|/g, "$1\\|");
    stats.canonical++;
    const r = range(old);
    return src.slice(r.start, from) + indent(body, prefix) + src.slice(to, r.end);
  };

  const body = emit(p.doc, doc, "") ?? canon(doc, "", null, 0) ?? "";
  return (p.bom ? "﻿" : "") + body;
}

/** Serializes, then re-parses the result; falls back to whole-block re-serialization when the splice misreads. */
export function serializeVerified(p: Parsed, doc: PMNode, opts: Options = {}) {
  const stats: Stats = { spliced: 0, canonical: 0 };
  const attempts: Options[] = [
    opts,
    { ...opts, noInlineSplice: true },
    { ...opts, noInlineSplice: true, noReinline: true },
    { ...opts, widen: true },
    { ...opts, widen: true, noInlineSplice: true, noReinline: true },
  ];
  let out = "";
  for (const [k, a] of attempts.entries()) {
    out = serialize(p, doc, a, stats);
    if (sameDoc(parse(out).doc, doc)) return { out, verified: true, fallback: k > 0, stats };
  }
  return { out, verified: false, fallback: true, stats };
}

/** Joins the end-of-line part of `a` to the blank lines and indentation of `b`. */
function joinGaps(a: string, b: string): string {
  const ia = a.indexOf("\n");
  const ib = b.indexOf("\n");
  if (ia < 0 || ib < 0) return b;
  return a.slice(0, ia) + b.slice(ib);
}

function children(n: PMNode): PMNode[] {
  const out: PMNode[] = [];
  n.forEach((c) => out.push(c));
  return out;
}

function sameAttrs(a: PMNode, b: PMNode, ignore: string[] = []): boolean {
  for (const k of Object.keys(a.attrs)) {
    if (ignore.includes(k)) continue;
    if (JSON.stringify(a.attrs[k]) !== JSON.stringify(b.attrs[k])) return false;
  }
  return true;
}

interface Item {
  ch: string | null;
  node: PMNode;
  marks: readonly Mark[];
}

function flatten(block: PMNode): Item[] {
  const out: Item[] = [];
  block.forEach((n) => {
    if (n.isText) for (const ch of n.text!.split("")) out.push({ ch, node: n, marks: n.marks });
    else out.push({ ch: null, node: n, marks: n.marks });
  });
  return out;
}

const sameMarks = (a: readonly Mark[], b: readonly Mark[]) =>
  a.length === b.length && a.every((m, i) => m.eq(b[i]!));

function sameItem(a: Item, b: Item): boolean {
  if (!sameMarks(a.marks, b.marks)) return false;
  if (a.ch === null || b.ch === null) return a.ch === b.ch && a.node.eq(b.node);
  return a.ch === b.ch;
}

function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>&|~$]/g, "\\$&");
}

/** Document equality that ignores how a reference link is written (shortcut, collapsed or full). */
export function sameDoc(a: PMNode, b: PMNode): boolean {
  const strip = (_k: string, v: unknown) => (_k === "referenceType" ? undefined : v);
  return JSON.stringify(a.toJSON(), strip) === JSON.stringify(b.toJSON(), strip);
}
