import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { connect, fixture, tempFile } from "./support.ts";

const blog = fixture("27-blog-post.md");
const paragraphEnd = "should be a one-word diff.";
const at = blog.indexOf(paragraphEnd) + paragraphEnd.length;

suite("a save waits for the editor to send its changes", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("a flush asks the editor for its changes and resolves once the edits sent before its answer are applied", async () => {
    const document = await vscode.workspace.openTextDocument(tempFile("blog.md", blog));
    const { connection, sent } = connect(document);
    await connection.receive({ type: "ready" });
    let done = false;
    const flushed = connection.flush(60000).then(() => (done = true));
    assert.deepEqual(sent.at(-1), { type: "flush", id: 1 });
    void connection.receive({
      type: "edit",
      baseVersion: document.version,
      edits: [{ start: at, end: at, insert: " Really." }],
    });
    void connection.receive({ type: "flushed", id: 1 });
    assert.equal(done, false);
    await flushed;
    assert.equal(document.getText(), blog.slice(0, at) + " Really." + blog.slice(at));
    connection.dispose();
    await document.save();
  });

  test("an answer resolves the flushes asked for up to its id, and not later ones", async () => {
    const document = await vscode.workspace.openTextDocument(tempFile("blog.md", blog));
    const { connection } = connect(document);
    const done: number[] = [];
    const first = connection.flush(60000).then(() => done.push(1));
    const second = connection.flush(60000).then(() => done.push(2));
    await connection.receive({ type: "flushed", id: 1 });
    await first;
    assert.deepEqual(done, [1]);
    await connection.receive({ type: "flushed", id: 2 });
    await second;
    assert.deepEqual(done, [1, 2]);
    connection.dispose();
  });

  test("a flush the editor does not answer resolves after its time limit", async () => {
    const document = await vscode.workspace.openTextDocument(tempFile("blog.md", blog));
    const { connection } = connect(document);
    const start = Date.now();
    await connection.flush(50);
    assert.ok(Date.now() - start >= 40);
    connection.dispose();
  });
});
