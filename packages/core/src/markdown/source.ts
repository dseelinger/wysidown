import type { Node } from "prosemirror-model";

/** A half-open span of source offsets, in UTF-16 code units, excluding any byte order mark. */
export interface Range {
  start: number;
  end: number;
}

/**
 * Where each inline position of a textblock came from. Positions are ProseMirror offsets within
 * the block's content; atoms (images, breaks, raw inline syntax) take one position.
 */
export interface CharMap {
  start: number[];
  end: number[];
  /** Text run each position belongs to; -1 for atoms and for text that could not be aligned. */
  run: number[];
  /** Source span of the whole inline content, delimiters included; -1 when unknown. */
  contentStart: number;
  contentEnd: number;
}

/** Markers the fallback writer uses, taken from the most frequent choice in the document. */
export interface Style {
  bullet: "-" | "*" | "+";
  emphasis: "*" | "_";
  strong: "*" | "_";
  fence: "`" | "~";
  rule: "-" | "*" | "_";
}

/** A parsed document together with everything needed to save it without disturbing unedited text. */
export interface MarkdownSource {
  /** The text as read, byte order mark excluded. */
  readonly text: string;
  readonly bom: boolean;
  readonly eol: "\n" | "\r\n";
  readonly doc: Node;
  readonly ranges: WeakMap<Node, Range>;
  readonly chars: WeakMap<Node, CharMap>;
  readonly style: Style;
}
