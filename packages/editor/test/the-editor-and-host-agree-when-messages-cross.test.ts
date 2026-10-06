import { parseMarkdown } from "@wysidown/core";
import { describe, expect, test } from "vitest";
import { Wire } from "./support/wire.ts";

describe("the editor and host agree when messages cross", () => {
  test("an edit made while another is in flight is sent at once, against the version the first produces", () => {
    const wire = new Wire("One two.\n");
    wire.edit((s) => s.tr.insertText("A", 4));
    wire.edit((s) => s.tr.insertText("B", 5));
    expect(wire.edits.map((e) => [e.baseVersion, e.seenVersion])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    wire.drain();
    expect(wire.host.text).toBe("OneAB two.\n");
  });

  test("edits made before an external change reached the editor are not applied to the changed text", () => {
    const wire = new Wire("One.\n\nTwo.\n");
    wire.edit((s) => s.tr.insertText("X", 4));
    wire.edit((s) => s.tr.insertText("Y", 5));
    // The second edit's base version is the version the change produces.
    wire.host.change("One.\n\nThree.\n");
    wire.drain();
    expect(wire.host.text).toBe("One.\n\nThree.\n");
    expect(wire.state.doc.eq(parseMarkdown("One.\n\nThree.\n").doc)).toBe(true);
  });

  test("an edit the host cannot apply is replaced by the host's text, with the edits sent after it", () => {
    const wire = new Wire("One two.\n");
    wire.edit((s) => s.tr.insertText("A", 4));
    wire.edit((s) => s.tr.insertText("B", 5));
    const first = wire.toHost[0];
    if (first?.type !== "edit") throw new Error("expected the first edit");
    wire.toHost[0] = { ...first, edits: [{ start: 99, end: 99, insert: "A" }] };
    wire.drain();
    expect(wire.host.text).toBe("One two.\n");
    expect(wire.state.doc.eq(parseMarkdown("One two.\n").doc)).toBe(true);
    wire.edit((s) => s.tr.insertText("C", 4));
    wire.drain();
    expect(wire.host.text).toBe("OneC two.\n");
  });

  test("an external change discards the edit in flight, and the host's text wins", () => {
    const wire = new Wire("One.\n\nTwo.\n");
    wire.edit((s) => s.tr.insertText("X", 4));
    wire.host.change("One.\n\nThree.\n");
    wire.deliverToEditor();
    wire.drain();
    expect(wire.host.text).toBe("One.\n\nThree.\n");
    expect(wire.state.doc.eq(parseMarkdown("One.\n\nThree.\n").doc)).toBe(true);
    expect(wire.edits).toHaveLength(1);
  });

  test("an edit made after an external change reached the editor is applied", () => {
    const wire = new Wire("One.\n\nTwo.\n");
    wire.edit((s) => s.tr.insertText("X", 4));
    wire.host.change("One.\n\nThree.\n");
    wire.deliverToEditor();
    wire.edit((s) => s.tr.insertText("Y", 4));
    // The host ignores the first edit, made before the change reached the editor, and accepts the second.
    wire.drain();
    expect(wire.edits.map((e) => e.baseVersion)).toEqual([1, 2]);
    expect(wire.host.text).toBe("OneY.\n\nThree.\n");
    expect(wire.state.doc.eq(parseMarkdown("OneY.\n\nThree.\n").doc)).toBe(true);
  });

  test("a change at a version the editor already holds is ignored", () => {
    const wire = new Wire("One.\n");
    const before = wire.state;
    expect(wire.session.receive({ type: "changed", text: "Other.\n", version: 1 })).toBeNull();
    expect(wire.state).toBe(before);
  });

  test("an acceptance with no edit in flight is ignored", () => {
    const wire = new Wire("One.\n");
    expect(wire.session.receive({ type: "accepted", version: 7 })).toBeNull();
    wire.edit((s) => s.tr.insertText("X", 4));
    expect(wire.edits.map((e) => e.baseVersion)).toEqual([1]);
  });
});
