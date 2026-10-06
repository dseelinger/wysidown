import {
  definitionTarget,
  headingAnchors,
  markdownLinkPath,
  retargetDefinition,
  schema,
  type LinkTarget,
} from "@wysidown/core";
import type { Mark, Node, ResolvedPos } from "prosemirror-model";
import { keydownHandler } from "prosemirror-keymap";
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

const link = schema.marks.link;

/** A link in the document: the positions of its text, and its mark. */
export interface LinkAt {
  from: number;
  to: number;
  mark: Mark;
}

/** The link around `$pos`, preferring the one after it; null when there is none. */
function linkAround($pos: ResolvedPos): LinkAt | null {
  const parent = $pos.parent;
  if (!parent.inlineContent) return null;
  const after = $pos.index() < parent.childCount ? parent.child($pos.index()) : null;
  const before = $pos.textOffset === 0 && $pos.index() > 0 ? parent.child($pos.index() - 1) : after;
  const mark = link.isInSet(after?.marks ?? []) ?? link.isInSet(before?.marks ?? []);
  if (!mark) return null;
  let from = -1;
  let to = -1;
  let found: LinkAt | null = null;
  parent.forEach((child, offset) => {
    const start = $pos.start() + offset;
    if (!mark.isInSet(child.marks)) {
      from = -1;
      return;
    }
    if (from < 0) from = start;
    to = start + child.nodeSize;
    if (from <= $pos.pos && $pos.pos <= to) found = { from, to, mark };
  });
  return found;
}

/** The link the selection is in: one that holds the cursor, or that the selection lies within. */
export function linkAt(state: EditorState): LinkAt | null {
  const { $from, $to } = state.selection;
  const found = linkAround($from);
  return found && $to.pos <= found.to ? found : null;
}

/** The link definition a reference link uses: its position and target. */
function definitionOf(doc: Node, mark: Mark): { pos: number; node: Node; target: LinkTarget } | null {
  const identifier = mark.attrs["identifier"] as string | null;
  let found: { pos: number; node: Node; target: LinkTarget } | null = null;
  doc.descendants((node, pos) => {
    if (found || node.isTextblock) return false;
    if (
      node.type.name === "raw_block" &&
      node.attrs["kind"] === "definition" &&
      node.attrs["identifier"] === identifier
    ) {
      const target = definitionTarget(node.attrs["source"] as string);
      if (target) found = { pos, node, target };
    }
    return !found;
  });
  return found;
}

/** Where a link goes: its own target, or the target of the definition it refers to. */
export function targetOf(doc: Node, mark: Mark): string | null {
  if (mark.attrs["identifier"] === null) return mark.attrs["href"] as string;
  return definitionOf(doc, mark)?.target.href ?? null;
}

/** For a link whose text is its target `href`, the text it shows for another target; otherwise null. */
function followsTarget(href: string, text: string): ((next: string) => string) | null {
  if (text === href) return (next) => next;
  if (href === "mailto:" + text) return (next) => next.replace(/^mailto:/, "");
  if (href === "http://" + text) return (next) => next.replace(/^https?:\/\//, "");
  return null;
}

/**
 * `mark` with the target `href`, changed in `tr`. A reference link's target is changed in its
 * definition; one whose definition is missing or cannot take the target becomes an inline link.
 */
function retarget(tr: Transaction, mark: Mark, href: string): Mark {
  if (mark.attrs["identifier"] === null) {
    return mark.attrs["href"] === href ? mark : link.create({ ...mark.attrs, href });
  }
  const definition = definitionOf(tr.doc, mark);
  if (definition?.target.href === href) return mark;
  const source = definition && retargetDefinition(definition.node.attrs["source"] as string, href);
  if (!source) return link.create({ href });
  tr.setNodeMarkup(definition.pos, null, { ...definition.node.attrs, source });
  return mark;
}

/**
 * Gives the link `at`, or the selection when `at` is null, the text `text` and the target `href`.
 * Empty text keeps the text, or with nothing selected shows the target. A link whose text is its
 * target keeps its text following the target unless the text is changed too. An empty target
 * takes the link off.
 */
export function setLink(at: LinkAt | null, text: string, href: string): Command {
  return (state, dispatch) => {
    const target = href.trim();
    if (target === "") return at ? unlink(at)(state, dispatch) : false;
    const { from, to } = at ?? state.selection;
    const $from = state.doc.resolve(from);
    if (!$from.parent.inlineContent || !$from.sameParent(state.doc.resolve(to))) return false;
    const shown = state.doc.textBetween(from, to, "", "￼");
    let now = text === "" ? (from === to ? target : shown) : text;
    if (at && now === shown) now = followsTarget(at.mark.attrs["href"] as string, shown)?.(target) ?? now;
    const tr = state.tr;
    const mark = at ? retarget(tr, at.mark, target) : link.create({ href: target });
    if (now === shown) {
      tr.addMark(from, to, mark);
    } else {
      const marks =
        from === to ? (state.storedMarks ?? $from.marks()) : ($from.marksAcross(state.doc.resolve(to)) ?? []);
      tr.replaceWith(from, to, schema.text(now, mark.addToSet(marks)));
      if (from === to) tr.setSelection(TextSelection.create(tr.doc, from + now.length));
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** True when the editor can follow a link to `href`: a heading in this document, or another markdown file. */
export function followable(href: string): boolean {
  return href.startsWith("#") || markdownLinkPath(href) !== null;
}

/**
 * Follows a link to `href`. A `#` target puts the cursor in the heading with that anchor and
 * scrolls it to the top; a link to another markdown file is passed to `open`. Returns false when
 * the link leads nowhere the editor can go.
 */
export function follow(view: EditorView, href: string, open: (href: string) => void): boolean {
  if (!href.startsWith("#")) {
    if (markdownLinkPath(href) === null) return false;
    open(href);
    return true;
  }
  let anchor = href.slice(1);
  try {
    anchor = decodeURIComponent(anchor);
  } catch {
    // An anchor that is not valid percent-encoding is matched as written.
  }
  const anchors = headingAnchors(view.state.doc);
  const pos = anchors.get(anchor) ?? anchors.get(anchor.toLowerCase());
  if (pos === undefined) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
  view.focus();
  (view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: "start" });
  return true;
}

/** Takes the link `at` off its text. */
export function unlink(at: LinkAt): Command {
  return (state, dispatch) => {
    dispatch?.(state.tr.removeMark(at.from, at.to, link));
    return true;
  };
}

/** The bubble under a link that shows its target, and the form that edits it. */
class LinkPopover {
  readonly #view: EditorView;
  readonly #dom: HTMLElement;
  readonly #target: HTMLElement;
  readonly #actions: HTMLElement;
  readonly #open: HTMLButtonElement;
  readonly #editButtons: HTMLButtonElement[];
  readonly #form: HTMLFormElement;
  readonly #text: HTMLInputElement;
  readonly #href: HTMLInputElement;
  /** The link being shown or edited; null while editing a new link. */
  #at: LinkAt | null = null;
  #editing = false;
  readonly #place = () => {
    this.#position();
  };

  constructor(view: EditorView, open: (href: string) => void) {
    this.#view = view;
    const document = view.dom.ownerDocument;
    const element = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = "") => {
      const child = parent.appendChild(document.createElement(tag));
      if (className) child.className = className;
      return child;
    };
    this.#dom = document.createElement("div");
    this.#dom.className = "link-popover";
    this.#dom.setAttribute("role", "dialog");
    this.#dom.setAttribute("aria-label", "Link");
    this.#dom.hidden = true;

    this.#actions = element(this.#dom, "div", "link-view");
    this.#target = element(this.#actions, "span", "link-target");
    const button = (label: string, action: () => void) => {
      const b = element(this.#actions, "button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      b.addEventListener("click", action);
      return b;
    };
    this.#open = button("Open", () => {
      const target = this.#at ? targetOf(this.#view.state.doc, this.#at.mark) : null;
      if (target !== null) follow(this.#view, target, open);
    });
    this.#open.title = "Open (Ctrl+click)";
    this.#editButtons = [
      button("Edit", () => {
        this.edit();
      }),
      button("Remove", () => {
        if (this.#at) unlink(this.#at)(this.#view.state, this.#view.dispatch);
        this.#view.focus();
      }),
    ];

    this.#form = element(this.#dom, "form", "link-form");
    const field = (label: string, name: string) => {
      const row = element(this.#form, "label");
      element(row, "span").textContent = label;
      const input = element(row, "input");
      input.type = "text";
      input.name = name;
      input.spellcheck = false;
      input.autocomplete = "off";
      return input;
    };
    this.#text = field("Text", "text");
    this.#href = field("URL", "href");
    this.#form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#apply();
    });
    this.#form.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.#apply();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.#stopEditing();
      }
    });
    this.#dom.addEventListener("focusout", (event) => {
      const next = event.relatedTarget as globalThis.Node | null;
      if (this.#editing && !this.#dom.contains(next)) {
        this.#editing = false;
        this.update();
      }
    });
    document.body.appendChild(this.#dom);
    document.addEventListener("scroll", this.#place, true);
    document.defaultView!.addEventListener("resize", this.#place);
  }

  /** Shows the target of the link the selection is in, or hides the bubble. */
  update(): void {
    if (this.#editing) return;
    const at = this.#view.hasFocus() ? linkAt(this.#view.state) : null;
    this.#at = at;
    if (!at) {
      this.#dom.hidden = true;
      return;
    }
    const target = targetOf(this.#view.state.doc, at.mark);
    this.#target.textContent = target ?? `[${(at.mark.attrs["label"] as string | null) ?? ""}] has no definition`;
    this.#target.title = this.#target.textContent;
    this.#actions.hidden = false;
    this.#form.hidden = true;
    this.#open.hidden = target === null || !followable(target);
    for (const b of this.#editButtons) b.hidden = !this.#view.editable;
    this.#dom.hidden = false;
    this.#position();
  }

  /** Opens the form for the link the selection is in, or for a new link on the selection. */
  edit(): boolean {
    const { state } = this.#view;
    if (!this.#view.editable) return false;
    const at = linkAt(state);
    const { from, to, $from } = state.selection;
    if (!at && (!$from.parent.inlineContent || !$from.sameParent(state.selection.$to))) return false;
    this.#at = at;
    this.#editing = true;
    const range = at ?? { from, to };
    this.#text.value = state.doc.textBetween(range.from, range.to, "", "￼");
    this.#text.disabled = this.#text.value.includes("￼");
    this.#href.value = at ? (targetOf(state.doc, at.mark) ?? "") : "";
    this.#actions.hidden = true;
    this.#form.hidden = false;
    this.#dom.hidden = false;
    this.#position();
    this.#href.focus();
    this.#href.select();
    return true;
  }

  #apply(): void {
    this.#editing = false;
    // The selection follows changes the host made while the form was open; the link is found again from it.
    const at = this.#at ? linkAt(this.#view.state) : null;
    setLink(at, this.#text.value, this.#href.value)(this.#view.state, this.#view.dispatch);
    this.#view.focus();
    this.update();
  }

  #stopEditing(): void {
    this.#editing = false;
    this.#view.focus();
    this.update();
  }

  #position(): void {
    if (this.#dom.hidden) return;
    const range = this.#at ?? this.#view.state.selection;
    const start = this.#view.coordsAtPos(Math.min(range.from, this.#view.state.doc.content.size));
    const window = this.#dom.ownerDocument.defaultView!;
    const { width } = this.#dom.getBoundingClientRect();
    this.#dom.style.left = `${String(Math.max(0, Math.min(start.left, window.innerWidth - width)))}px`;
    this.#dom.style.top = `${String(start.bottom + 4)}px`;
  }

  destroy(): void {
    const document = this.#dom.ownerDocument;
    document.removeEventListener("scroll", this.#place, true);
    document.defaultView!.removeEventListener("resize", this.#place);
    this.#dom.remove();
  }
}

/**
 * Shows a link's target under it, edits links from the bubble or with Mod-k, and follows links
 * from the bubble or with Mod-click. `open` is called with the target of a link to another
 * markdown file.
 */
export function links(open: (href: string) => void): Plugin {
  let popover: LinkPopover | null = null;
  return new Plugin({
    props: {
      handleKeyDown: keydownHandler({ "Mod-k": () => popover?.edit() ?? false }),
      handleClick(view, pos, event) {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const at = linkAround(view.state.doc.resolve(pos));
        const target = at ? targetOf(view.state.doc, at.mark) : null;
        return target !== null && follow(view, target, open);
      },
      handleDOMEvents: {
        focus() {
          popover?.update();
          return false;
        },
        blur() {
          popover?.update();
          return false;
        },
      },
    },
    view(view) {
      popover = new LinkPopover(view, open);
      return {
        update() {
          popover?.update();
        },
        destroy() {
          popover?.destroy();
          popover = null;
        },
      };
    },
  });
}
