import type { Node } from "prosemirror-model";

/** The anchor GitHub gives a heading whose text is `text`, before repeats are numbered. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/**
 * The position of each heading in `doc`, by the anchor GitHub gives it: `## Getting started` is
 * `getting-started`, and later headings with the same anchor get `-1`, `-2` and so on.
 */
export function headingAnchors(doc: Node): Map<string, number> {
  const anchors = new Map<string, number>();
  const repeats = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return !node.isTextblock;
    const first = slug(node.textContent);
    let anchor = first;
    while (anchors.has(anchor)) {
      const count = (repeats.get(first) ?? 0) + 1;
      repeats.set(first, count);
      anchor = `${first}-${String(count)}`;
    }
    anchors.set(anchor, pos);
    return false;
  });
  return anchors;
}
