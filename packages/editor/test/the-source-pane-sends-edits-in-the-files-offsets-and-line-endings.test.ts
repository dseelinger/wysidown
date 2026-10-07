import type { EditorMessage, HostMessage } from "@wysidown/core";
import { describe, expect, test } from "vitest";
import { MemoryHost } from "../harness/memory-host.ts";
import { SourceSession } from "../src/source-session.ts";
import { realisticCases } from "./support/corpus.ts";

/** A source session joined to an in-memory host; messages are delivered when a test drains them. */
class SourceWire {
  readonly toHost: EditorMessage[] = [];
  readonly toEditor: HostMessage[] = [];
  readonly session = new SourceSession((m) => this.toHost.push(m));
  readonly host: MemoryHost;
  /** The shown text after the latest message that replaced it. */
  shown: string | null = null;

  constructor(text: string) {
    this.host = new MemoryHost((m) => this.toEditor.push(m), text);
    this.toHost.push({ type: "ready" });
    this.drain();
  }

  drain(): void {
    while (this.toHost.length > 0 || this.toEditor.length > 0) {
      const toHost = this.toHost.shift();
      if (toHost) this.host.receive(toHost);
      const toEditor = this.toEditor.shift();
      if (toEditor) this.shown = this.session.receive(toEditor) ?? this.shown;
    }
  }
}

const withoutBom = (text: string) => text.replace(/^\uFEFF/, "");

describe("the source pane sends edits in the file's offsets and line endings", () => {
  test.each(realisticCases())("$name is shown without its byte order mark and with LF line breaks", ({ text }) => {
    const wire = new SourceWire(text);
    expect(wire.shown).toBe(withoutBom(text).replace(/\r\n/g, "\n"));
  });

  test.each(realisticCases())("typing a line into the middle of $name inserts only its bytes", ({ text }) => {
    const wire = new SourceWire(text);
    const shown = wire.session.shown;
    const at = shown.indexOf("\n", shown.length >> 1) + 1;
    wire.session.change([{ from: at, to: at, insert: "EDITED\n" }]);
    wire.drain();
    const bom = text.length - withoutBom(text).length;
    const offset = bom + wire.session.fromShown(at);
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    expect(wire.host.text).toBe(text.slice(0, offset) + "EDITED" + eol + text.slice(offset));
    expect(wire.session.shown).toBe(shown.slice(0, at) + "EDITED\n" + shown.slice(at));
  });

  test.each(realisticCases())(
    "every offset of $name outside a line break maps to the shown text and back",
    ({ text }) => {
      const wire = new SourceWire(text);
      const source = withoutBom(text);
      for (let offset = 0; offset <= source.length; offset++) {
        if (source[offset - 1] === "\r" && source[offset] === "\n") continue;
        expect(wire.session.fromShown(wire.session.toShown(offset))).toBe(offset);
      }
    },
  );

  test("deleting a CRLF line break deletes both of its characters", () => {
    const wire = new SourceWire("One\r\nTwo\r\n");
    wire.session.change([{ from: 3, to: 4, insert: "" }]);
    wire.drain();
    expect(wire.host.text).toBe("OneTwo\r\n");
  });

  test("changes at several places are sent as one edit", () => {
    const wire = new SourceWire("One\nTwo\n");
    wire.session.change([
      { from: 0, to: 0, insert: "A" },
      { from: 4, to: 7, insert: "B" },
    ]);
    wire.drain();
    expect(wire.host.text).toBe("AOne\nB\n");
  });

  test("edits made before the host accepts the first are each based on the one before", () => {
    const wire = new SourceWire("One\n");
    wire.session.change([{ from: 3, to: 3, insert: "," }]);
    wire.session.change([{ from: 4, to: 4, insert: " two" }]);
    wire.drain();
    expect(wire.host.text).toBe("One, two\n");
  });

  test("a flush is answered once every edit is accepted", () => {
    const wire = new SourceWire("One\n");
    wire.session.change([{ from: 0, to: 0, insert: "X" }]);
    const flushed = wire.host.flush();
    wire.drain();
    return expect(flushed).resolves.toBe("XOne\n");
  });

  test("an external change replaces the shown text and discards edits not accepted", () => {
    const wire = new SourceWire("One\n");
    wire.session.change([{ from: 0, to: 0, insert: "X" }]);
    wire.host.change("Two\r\n");
    wire.drain();
    expect(wire.host.text).toBe("Two\r\n");
    expect(wire.shown).toBe("Two\n");
    wire.session.change([{ from: 3, to: 3, insert: "\n" }]);
    wire.drain();
    expect(wire.host.text).toBe("Two\r\n\r\n");
  });
});
