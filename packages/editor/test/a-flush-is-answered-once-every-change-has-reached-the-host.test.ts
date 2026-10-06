import { describe, expect, test } from "vitest";
import { Wire } from "./support/wire.ts";

describe("a flush is answered once every change has reached the host", () => {
  test("typing while an edit is in flight reaches the host before the answer", async () => {
    const wire = new Wire("One.\n");
    wire.edit((s) => s.tr.insertText("a", 4));
    wire.edit((s) => s.tr.insertText("b", 5));
    wire.edit((s) => s.tr.insertText("c", 6));
    expect(wire.edits).toHaveLength(1);
    const flushed = wire.host.flush();
    wire.drain();
    expect(await flushed).toBe("Oneabc.\n");
  });

  test("two flushes asked while an edit is in flight are both answered once it is accepted", async () => {
    const wire = new Wire("One.\n");
    wire.edit((s) => s.tr.insertText("a", 4));
    const first = wire.host.flush();
    wire.edit((s) => s.tr.insertText("b", 5));
    const second = wire.host.flush();
    wire.drain();
    expect(await Promise.all([first, second])).toEqual(["Oneab.\n", "Oneab.\n"]);
  });

  test("with nothing to send, the answer comes straight back", async () => {
    const wire = new Wire("One.\n");
    const flushed = wire.host.flush();
    wire.drain();
    expect(await flushed).toBe("One.\n");
    expect(wire.edits).toEqual([]);
  });

  test("an edit the host refused is replaced by the host's text before the answer", async () => {
    const wire = new Wire("One.\n");
    wire.edit((s) => s.tr.insertText("a", 4));
    wire.host.change("Two.\n");
    const flushed = wire.host.flush();
    wire.drain();
    expect(await flushed).toBe("Two.\n");
    expect(wire.state.doc.textContent).toBe("Two.");
  });
});
