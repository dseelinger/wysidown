/** What the find bar searches for, and the replace text. */
export interface FindQuery {
  search: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** True when `search` is a regular expression; `replace` may then use `$1` and `$&`. */
  regexp: boolean;
}

/** A pane the find bar searches. Replace and Replace All each change the document in one transaction. */
export interface FindTarget {
  /** Highlights the matches of `query`, or none when null. With `select`, selects the first match at or after the selection's start. */
  setQuery(query: FindQuery | null, select: boolean): void;
  /** The number of matches, and the 1-based index of the one selected; 0 when the selection is not a match. */
  matches(): { current: number; total: number };
  findNext(): void;
  findPrevious(): void;
  /** Replaces the selected match and selects the next; selects the next match when none is selected. */
  replace(): void;
  replaceAll(): void;
  /** The selected text when it is on one line; otherwise "". */
  selectedText(): string;
  /** Calls `listener` after every change to the document or the selection; null stops. */
  onUpdate(listener: (() => void) | null): void;
  /** Gives the pane the keyboard. */
  focus(): void;
}

/** The find and replace bar. It handles its keys on the page, so it works from either pane. */
export interface FindBar {
  /** Searches `target` from now on, keeping the query; null searches nothing. */
  attach(target: FindTarget | null): void;
  /** Opens the bar, with the replace row when `replace` is true, filled with the selected text when it is on one line. */
  open(replace: boolean): void;
  /** Closes the bar and gives the pane the keyboard. */
  close(): void;
  destroy(): void;
}

type Option = "caseSensitive" | "wholeWord" | "regexp";

/** Creates the find bar in `document`'s body, hidden. */
export function createFindBar(document: Document): FindBar {
  return new Bar(document);
}

class Bar implements FindBar {
  readonly #dom: HTMLElement;
  readonly #toggle: HTMLButtonElement;
  readonly #find: HTMLInputElement;
  readonly #replace: HTMLInputElement;
  readonly #replaceRow: HTMLElement;
  readonly #count: HTMLElement;
  readonly #options: Record<Option, HTMLButtonElement>;
  readonly #set: Record<Option, boolean> = { caseSensitive: false, wholeWord: false, regexp: false };
  #target: FindTarget | null = null;
  #open = false;
  readonly #keydown = (event: KeyboardEvent) => {
    this.#key(event);
  };

  constructor(document: Document) {
    const element = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className: string) => {
      const child = parent.appendChild(document.createElement(tag));
      child.className = className;
      return child;
    };
    const button = (parent: HTMLElement, label: string, title: string, action: () => void) => {
      const b = element(parent, "button", "find-button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.setAttribute("aria-label", title.replace(/ \(.*\)$/, ""));
      b.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      b.addEventListener("click", action);
      return b;
    };
    this.#dom = document.createElement("div");
    this.#dom.className = "find-bar";
    this.#dom.setAttribute("role", "dialog");
    this.#dom.setAttribute("aria-label", "Find and replace");
    this.#dom.hidden = true;

    this.#toggle = button(this.#dom, "›", "Toggle Replace", () => {
      this.#showReplace(this.#toggle.getAttribute("aria-expanded") !== "true");
    });
    this.#toggle.classList.add("find-toggle");
    const rows = element(this.#dom, "div", "find-rows");
    const findRow = element(rows, "div", "find-row");
    const input = (parent: HTMLElement, label: string) => {
      const field = element(parent, "input", "find-input");
      field.type = "text";
      field.placeholder = label;
      field.setAttribute("aria-label", label);
      field.spellcheck = false;
      field.autocomplete = "off";
      return field;
    };
    this.#find = input(findRow, "Find");
    this.#find.addEventListener("input", () => {
      this.#apply(true);
    });
    const option = (name: Option, label: string, title: string) => {
      const b = button(findRow, label, title, () => {
        this.#flip(name);
      });
      b.classList.add("find-option");
      b.setAttribute("aria-pressed", "false");
      return b;
    };
    this.#options = {
      caseSensitive: option("caseSensitive", "Aa", "Match Case (Alt+C)"),
      wholeWord: option("wholeWord", "ab", "Match Whole Word (Alt+W)"),
      regexp: option("regexp", ".*", "Use Regular Expression (Alt+R)"),
    };
    this.#count = element(findRow, "span", "find-count");
    this.#count.setAttribute("aria-live", "polite");
    button(findRow, "↑", "Previous Match (Shift+Enter)", () => {
      this.#target?.findPrevious();
    });
    button(findRow, "↓", "Next Match (Enter)", () => {
      this.#target?.findNext();
    });
    button(findRow, "×", "Close (Escape)", () => {
      this.close();
    });

    this.#replaceRow = element(rows, "div", "find-row");
    this.#replace = input(this.#replaceRow, "Replace");
    this.#replace.addEventListener("input", () => {
      this.#apply(false);
    });
    button(this.#replaceRow, "Replace", "Replace (Enter)", () => {
      this.#target?.replace();
    });
    button(this.#replaceRow, "Replace All", "Replace All (Ctrl+Alt+Enter)", () => {
      this.#target?.replaceAll();
    });
    this.#showReplace(false);

    document.body.appendChild(this.#dom);
    document.defaultView?.addEventListener("keydown", this.#keydown, true);
  }

  attach(target: FindTarget | null): void {
    this.#target?.onUpdate(null);
    this.#target = target;
    target?.onUpdate(() => {
      this.#showCount();
    });
    if (this.#open) this.#apply(false);
  }

  open(replace: boolean): void {
    if (!this.#target) return;
    const selected = this.#target.selectedText();
    if (selected !== "") this.#find.value = selected;
    this.#showReplace(replace);
    this.#open = true;
    this.#dom.hidden = false;
    this.#apply(true);
    const field = replace && this.#find.value !== "" ? this.#replace : this.#find;
    field.focus();
    field.select();
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#dom.hidden = true;
    this.#target?.setQuery(null, false);
    this.#target?.focus();
  }

  destroy(): void {
    this.attach(null);
    this.#dom.ownerDocument.defaultView?.removeEventListener("keydown", this.#keydown, true);
    this.#dom.remove();
  }

  /** Handles the bar's keys, wherever the keyboard is on the page. */
  #key(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const command = event.ctrlKey || event.metaKey;
    const plain = !event.altKey && !event.shiftKey;
    const option = event.altKey && !command && !event.shiftKey;
    const letter = event.key.toLowerCase();
    const at = event.target;
    if (command && plain && letter === "f") this.open(false);
    else if (command && plain && letter === "h") this.open(true);
    else if (event.key === "F3" && !command && !event.altKey) {
      // Opening selects the first match from the cursor, which is the next one.
      const opened = !this.#open;
      if (opened) this.open(false);
      if (event.shiftKey) this.#target?.findPrevious();
      else if (!opened) this.#target?.findNext();
    } else if (!this.#open) return;
    else if (event.key === "Escape" && (this.#dom.contains(at as Node | null) || !isControl(at))) this.close();
    else if (option && letter === "c") this.#flip("caseSensitive");
    else if (option && letter === "w") this.#flip("wholeWord");
    else if (option && letter === "r") this.#flip("regexp");
    else if (command && event.shiftKey && !event.altKey && event.code === "Digit1") this.#target?.replace();
    else if (command && event.altKey && event.key === "Enter") this.#target?.replaceAll();
    else if (event.key === "Enter" && !command && !event.altKey && at === this.#find) {
      if (event.shiftKey) this.#target?.findPrevious();
      else this.#target?.findNext();
    } else if (event.key === "Enter" && !command && !event.altKey && at === this.#replace) this.#target?.replace();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  #flip(name: Option): void {
    this.#set[name] = !this.#set[name];
    this.#options[name].setAttribute("aria-pressed", String(this.#set[name]));
    this.#apply(true);
  }

  #showReplace(on: boolean): void {
    this.#replaceRow.hidden = !on;
    this.#toggle.setAttribute("aria-expanded", String(on));
    this.#toggle.textContent = on ? "⌄" : "›";
  }

  /** Sends the query to the target; with `select`, the first match from the selection is selected. */
  #apply(select: boolean): void {
    this.#find.classList.toggle("find-invalid", this.#set.regexp && !validRegExp(this.#find.value));
    this.#target?.setQuery({ search: this.#find.value, replace: this.#replace.value, ...this.#set }, select);
    this.#showCount();
  }

  #showCount(): void {
    if (!this.#open || !this.#target) return;
    const { current, total } = this.#target.matches();
    this.#count.textContent =
      this.#find.value === ""
        ? ""
        : total === 0
          ? "No results"
          : `${current === 0 ? "?" : String(current)} of ${String(total)}`;
  }
}

/** True for an element that takes keys of its own, such as a field or a button outside the bar. */
function isControl(target: EventTarget | null): boolean {
  const name = (target as Element | null)?.tagName;
  return name === "INPUT" || name === "TEXTAREA" || name === "SELECT" || name === "BUTTON";
}

function validRegExp(source: string): boolean {
  try {
    new RegExp(source, "u");
    return true;
  } catch {
    return false;
  }
}
