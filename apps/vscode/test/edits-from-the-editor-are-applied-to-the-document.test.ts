import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as vscode from "vscode";
import { connect, fixture, tempFile, until } from "./support.ts";

const blog = fixture("27-blog-post.md");
const paragraphEnd = "should be a one-word diff.";
const at = blog.indexOf(paragraphEnd) + paragraphEnd.length;

suite("edits from the editor are applied to the document", () => {
  const opened: vscode.TextDocument[] = [];

  async function open(bytes: string | Uint8Array): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(tempFile("blog.md", bytes));
    opened.push(document);
    return document;
  }

  teardown(async () => {
    for (const document of opened.splice(0)) if (document.isDirty) await document.save();
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("a ready editor is sent the document's text", async () => {
    const document = await open(blog);
    const { connection, sent } = connect(document);
    await connection.receive({ type: "ready" });
    assert.deepEqual(sent, [{ type: "load", text: blog, version: 1 }]);
    connection.dispose();
  });

  test("an edit is applied to the document and accepted at the next version", async () => {
    const document = await open(blog);
    const { connection, sent } = connect(document);
    await connection.receive({ type: "ready" });
    await connection.receive({
      type: "edit",
      baseVersion: 1,
      seenVersion: 1,
      edits: [{ start: at, end: at, insert: " Really." }],
    });
    assert.equal(document.getText(), blog.slice(0, at) + " Really." + blog.slice(at));
    assert.ok(document.isDirty);
    assert.deepEqual(sent.slice(1), [{ type: "accepted", version: 2 }]);
    connection.dispose();
  });

  test("edits sent before the first is accepted are applied in turn", async () => {
    const document = await open(blog);
    const { connection, sent } = connect(document);
    await connection.receive({ type: "ready" });
    void connection.receive({
      type: "edit",
      baseVersion: 1,
      seenVersion: 1,
      edits: [{ start: at, end: at, insert: " Really" }],
    });
    await connection.receive({
      type: "edit",
      baseVersion: 2,
      seenVersion: 1,
      edits: [{ start: at + 7, end: at + 7, insert: "." }],
    });
    assert.equal(document.getText(), blog.slice(0, at) + " Really." + blog.slice(at));
    assert.deepEqual(sent.slice(1), [
      { type: "accepted", version: 2 },
      { type: "accepted", version: 3 },
    ]);
    connection.dispose();
  });

  test("an edit made before a change reached the editor is ignored", async () => {
    const document = await open(blog);
    const { connection, sent } = connect(document);
    await connection.receive({ type: "ready" });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(0, 0), "Hello\n\n");
    assert.ok(await vscode.workspace.applyEdit(edit));
    await until(() => sent.length === 2);
    await connection.receive({
      type: "edit",
      baseVersion: 2,
      seenVersion: 1,
      edits: [{ start: 0, end: 0, insert: "x" }],
    });
    assert.equal(document.getText(), "Hello\n\n" + blog);
    assert.equal(sent.length, 2);
    connection.dispose();
  });

  test("saving writes only the typed bytes and keeps CRLF line endings and the byte order mark", async () => {
    const crlf = blog.replace(/\n/g, "\r\n");
    const document = await open("﻿" + crlf);
    assert.equal(document.getText(), crlf);
    const offset = crlf.indexOf(paragraphEnd) + paragraphEnd.length;
    const { connection } = connect(document);
    await connection.receive({ type: "ready" });
    await connection.receive({
      type: "edit",
      baseVersion: 1,
      seenVersion: 1,
      edits: [{ start: offset, end: offset, insert: " Really." }],
    });
    assert.ok(await document.save());
    const expected = Buffer.from("﻿" + crlf.slice(0, offset) + " Really." + crlf.slice(offset), "utf8");
    assert.deepEqual(readFileSync(document.uri.fsPath), expected);
    connection.dispose();
  });

  test("an edit against a version the host is not at is discarded and the editor is sent the current text", async () => {
    const document = await open(blog);
    const { connection, sent } = connect(document);
    await connection.receive({ type: "ready" });
    await connection.receive({
      type: "edit",
      baseVersion: 2,
      seenVersion: 1,
      edits: [{ start: at, end: at, insert: " Really." }],
    });
    assert.equal(document.getText(), blog);
    assert.deepEqual(sent.slice(1), [{ type: "changed", text: blog, version: 2 }]);
    connection.dispose();
  });

  test("an edit outside the text is discarded and the editor is sent the current text", async () => {
    const document = await open(blog);
    const { connection, sent } = connect(document);
    await connection.receive({ type: "ready" });
    await connection.receive({
      type: "edit",
      baseVersion: 1,
      seenVersion: 1,
      edits: [{ start: blog.length + 1, end: blog.length + 2, insert: "x" }],
    });
    assert.equal(document.getText(), blog);
    assert.deepEqual(sent.slice(1), [{ type: "changed", text: blog, version: 2 }]);
    connection.dispose();
  });

  test("a malformed message is ignored", async () => {
    const document = await open(blog);
    const { connection, sent } = connect(document);
    await connection.receive({
      type: "edit",
      baseVersion: 0,
      seenVersion: 0,
      edits: [{ start: "0", end: 0, insert: "x" }],
    });
    await connection.receive("ready");
    await connection.receive(null);
    assert.equal(document.getText(), blog);
    assert.deepEqual(sent, []);
    connection.dispose();
  });

  test("a change made in another editor is sent to the editor", async () => {
    const document = await open(blog);
    const { connection, sent } = connect(document);
    await connection.receive({ type: "ready" });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(0, 0), "Hello\n\n");
    assert.ok(await vscode.workspace.applyEdit(edit));
    await until(() => sent.length === 2);
    assert.deepEqual(sent[1], { type: "changed", text: "Hello\n\n" + blog, version: 2 });
    connection.dispose();
  });

  test("VS Code's undo reverts the editor's edit and the editor is sent the reverted text", async () => {
    const document = await open(blog);
    await vscode.window.showTextDocument(document);
    const { connection, sent } = connect(document);
    await connection.receive({ type: "ready" });
    await connection.receive({
      type: "edit",
      baseVersion: 1,
      seenVersion: 1,
      edits: [{ start: at, end: at, insert: " Really." }],
    });
    await vscode.commands.executeCommand("undo");
    await until(() => sent.length === 3);
    assert.equal(document.getText(), blog);
    assert.equal(document.isDirty, false);
    assert.deepEqual(sent[2], { type: "changed", text: blog, version: 3 });
    connection.dispose();
  });
});
