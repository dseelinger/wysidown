import { decodeNamedCharacterReference } from "decode-named-character-reference";

const asciiPunctuation = /[!-/:-@[-`{-~]/;
const characterReference = /^&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/;

/**
 * Maps each UTF-16 unit of `value` (a parsed text value) to the span of `source[from, to)` it was
 * read from. Backslash escapes and character references map to their whole span; carriage returns
 * and the line prefixes of continuation lines are skipped. Returns null when the two cannot be
 * aligned.
 */
export function mapText(
  source: string,
  from: number,
  to: number,
  value: string,
): { start: number[]; end: number[] } | null {
  const start: number[] = [];
  const end: number[] = [];
  let p = from;
  for (let i = 0; i < value.length;) {
    if (p >= to) return null;
    const c = source[p]!;
    const v = value[i]!;
    if (c === v) {
      start.push(p);
      end.push(p + 1);
      p++;
      i++;
      continue;
    }
    if (c === "\\" && source[p + 1] === v && asciiPunctuation.test(v)) {
      start.push(p);
      end.push(p + 2);
      p += 2;
      i++;
      continue;
    }
    if (c === "&") {
      const m = characterReference.exec(source.slice(p, p + 40));
      const decoded = m ? decodeReference(m) : null;
      if (m && decoded && value.startsWith(decoded, i)) {
        start.push(...new Array<number>(decoded.length).fill(p));
        end.push(...new Array<number>(decoded.length).fill(p + m[0].length));
        i += decoded.length;
        p += m[0].length;
        continue;
      }
    }
    const afterNewline = i > 0 && value[i - 1] === "\n";
    const skippable =
      c === "\r" || ((c === " " || c === "\t") && (v === "\n" || afterNewline)) || (c === ">" && afterNewline);
    if (!skippable) return null;
    p++;
  }
  return { start, end };
}

function decodeReference(m: RegExpExecArray): string | null {
  const [, hex, decimal, name] = m;
  if (hex) return codePoint(parseInt(hex, 16));
  if (decimal) return codePoint(parseInt(decimal, 10));
  const named = decodeNamedCharacterReference(name!);
  return named === false ? null : named;
}

function codePoint(n: number): string | null {
  return n > 0x10ffff ? null : String.fromCodePoint(n === 0 ? 0xfffd : n);
}
