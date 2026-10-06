/** Replaces `text[start, end)` with `insert`. Offsets are UTF-16 code units in the text before the edit. */
export interface TextEdit {
  start: number;
  end: number;
  insert: string;
}

/**
 * The single edit that turns `before` into `after`, covering only the span between their common
 * prefix and suffix; null when they are equal. Never splits a surrogate pair or a CRLF.
 */
export function diffText(before: string, after: string): TextEdit | null {
  if (before === after) return null;
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  while (prefix > 0 && splitsPair(before, prefix)) prefix--;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++;
  }
  while (suffix > 0 && splitsPair(before, before.length - suffix)) suffix--;
  return { start: prefix, end: before.length - suffix, insert: after.slice(prefix, after.length - suffix) };
}

/** Applies edits whose offsets all refer to `text` as given; edits must not overlap. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const ordered = [...edits].sort((x, y) => y.start - x.start);
  let out = text;
  let floor = Infinity;
  for (const e of ordered) {
    if (e.end > floor || e.start > e.end || e.start < 0 || e.end > text.length) {
      throw new RangeError(`Invalid or overlapping edit ${e.start}-${e.end}`);
    }
    out = out.slice(0, e.start) + e.insert + out.slice(e.end);
    floor = e.start;
  }
  return out;
}

/** True when offset `i` falls between the two halves of a surrogate pair or of a CRLF. */
function splitsPair(text: string, i: number): boolean {
  const prev = text.charCodeAt(i - 1);
  const next = text.charCodeAt(i);
  return (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) || (prev === 13 && next === 10);
}
