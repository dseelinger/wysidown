import { TextSelection } from "prosemirror-state";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Wire } from "./support/wire.ts";

const pause = 1000;

/** Types `text` one character at a time at the end of the first paragraph, which ends at `end`. */
function type(wire: Wire, end: number, text: string): void {
  for (let k = 0; k < text.length; k++) wire.edit((s) => s.tr.insertText(text.charAt(k), end + k));
}

function inserted(wire: Wire): string[] {
  return wire.edits.map((e) => e.edits.map((t) => t.insert).join(""));
}

describe("typing reaches a host that owns undo a word at a time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("typed letters reach the host as one edit once typing pauses", () => {
    const wire = new Wire("One\n", pause);
    type(wire, 4, "abc");
    vi.advanceTimersByTime(pause - 1);
    expect(wire.edits).toEqual([]);
    vi.advanceTimersByTime(1);
    wire.drain();
    expect(inserted(wire)).toEqual(["abc"]);
    expect(wire.host.text).toBe("Oneabc\n");
  });

  test("each keystroke starts the pause again", () => {
    const wire = new Wire("One\n", pause);
    type(wire, 4, "a");
    vi.advanceTimersByTime(pause - 1);
    type(wire, 5, "b");
    vi.advanceTimersByTime(pause - 1);
    expect(wire.edits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(inserted(wire)).toEqual(["ab"]);
  });

  test("a space typed after a word sends the word, and the space starts the next one", () => {
    const wire = new Wire("One\n", pause);
    type(wire, 4, " two three");
    expect(inserted(wire)).toEqual([" two"]);
    vi.advanceTimersByTime(pause);
    wire.drain();
    expect(inserted(wire)).toEqual([" two", " three"]);
    expect(wire.host.text).toBe("One two three\n");
  });

  test("a deleted character is held with the typing around it", () => {
    const wire = new Wire("One\n", pause);
    type(wire, 4, "ab");
    wire.edit((s) => s.tr.delete(5, 6));
    type(wire, 5, "c");
    expect(wire.edits).toEqual([]);
    vi.advanceTimersByTime(pause);
    expect(inserted(wire)).toEqual(["ac"]);
  });

  test("Enter sends the held typing straight away, with the new paragraph", () => {
    const wire = new Wire("One\n", pause);
    type(wire, 4, "ab");
    wire.edit((s) => s.tr.split(6));
    wire.drain();
    expect(wire.edits).toHaveLength(1);
    expect(wire.state.doc.childCount).toBe(2);
    expect(wire.host.text.startsWith("Oneab\n")).toBe(true);
  });

  test("moving the cursor sends the held typing", () => {
    const wire = new Wire("One\n", pause);
    type(wire, 4, "ab");
    wire.edit((s) => s.tr.setSelection(TextSelection.create(s.doc, 1)));
    expect(inserted(wire)).toEqual(["ab"]);
  });

  test("a change that moves neither text nor cursor keeps the typing held", () => {
    const wire = new Wire("One\n", pause);
    type(wire, 4, "ab");
    wire.edit((s) => s.tr.setMeta("unrelated", true));
    expect(wire.edits).toEqual([]);
  });

  test("deleting more than one character sends at once", () => {
    const wire = new Wire("One two\n", pause);
    type(wire, 8, "ab");
    wire.edit((s) => s.tr.delete(1, 3));
    wire.drain();
    expect(wire.host.text).toBe("e twoab\n");
  });

  test("a paste sends at once", () => {
    const wire = new Wire("One\n", pause);
    wire.edit((s) => s.tr.insertText("xy").setMeta("uiEvent", "paste"));
    wire.drain();
    expect(wire.host.text).toBe("xyOne\n");
  });

  test("a flush from the host sends the held typing before its answer", async () => {
    const wire = new Wire("One\n", pause);
    type(wire, 4, "ab");
    const flushed = wire.host.flush();
    wire.drain();
    expect(await flushed).toBe("Oneab\n");
  });

  test("the editor can send its held typing before the page loses the keyboard", () => {
    const wire = new Wire("One\n", pause);
    type(wire, 4, "ab");
    wire.session.sendHeld();
    wire.drain();
    expect(wire.host.text).toBe("Oneab\n");
    vi.advanceTimersByTime(pause);
    expect(wire.edits).toHaveLength(1);
  });

  test("undo while typing is held removes the held typing, which never reaches the host", () => {
    const wire = new Wire("One\n", pause);
    type(wire, 4, "ab");
    expect(wire.session.undoHeld()?.doc.textContent).toBe("One");
    expect(wire.state.doc.textContent).toBe("One");
    vi.advanceTimersByTime(pause);
    expect(wire.edits).toEqual([]);
    expect(wire.session.holding).toBe(false);
  });

  test("undo while typing is held keeps the words already sent", () => {
    const wire = new Wire("One\n", pause);
    type(wire, 4, " two three");
    expect(wire.session.undoHeld()?.doc.textContent).toBe("One two");
    wire.drain();
    expect(wire.host.text).toBe("One two\n");
  });

  test("typing held while the host changes another block is kept, and reaches the host after the pause", () => {
    const wire = new Wire("One\n\nTwo\n", pause);
    type(wire, 4, "ab");
    wire.host.change("One\n\nTwo!\n");
    wire.drain();
    expect(wire.state.doc.textContent).toBe("OneabTwo!");
    expect(wire.session.holding).toBe(true);
    vi.advanceTimersByTime(pause);
    wire.drain();
    expect(wire.host.text).toBe("Oneab\n\nTwo!\n");
  });

  test("undo after the host changes another block removes the held typing and keeps the host's change", () => {
    const wire = new Wire("One\n\nTwo\n", pause);
    type(wire, 4, "ab");
    wire.host.change("Zero\n\nOne\n\nTwo\n");
    wire.drain();
    type(wire, 12, "c");
    expect(wire.session.undoHeld()?.doc.textContent).toBe("ZeroOneTwo");
    vi.advanceTimersByTime(pause);
    expect(wire.session.holding).toBe(false);
    wire.drain();
    expect(wire.host.text).toBe("Zero\n\nOne\n\nTwo\n");
  });

  test("typing held while the host changes the same block gives way to the host's text", () => {
    const wire = new Wire("One\n\nTwo\n", pause);
    type(wire, 4, "ab");
    wire.host.change("One!\n\nTwo\n");
    wire.drain();
    expect(wire.state.doc.textContent).toBe("One!Two");
    expect(wire.session.holding).toBe(false);
    vi.advanceTimersByTime(pause);
    expect(wire.edits).toEqual([]);
  });

  test("an unedited block keeps its bytes after the host changes another while typing is held", () => {
    const wire = new Wire("One\n\n*  Two\n", pause);
    type(wire, 4, "ab");
    wire.host.change("One\n\n*  Two\n\nThree\n");
    wire.drain();
    vi.advanceTimersByTime(pause);
    wire.drain();
    expect(wire.host.text).toBe("Oneab\n\n*  Two\n\nThree\n");
  });
});
