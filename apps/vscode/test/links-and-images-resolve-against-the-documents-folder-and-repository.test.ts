import * as assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { folderOf, linkedFile } from "../src/resources.ts";

/** The URI of the file at the path joined from `parts`. */
function file(...parts: string[]): string {
  return vscode.Uri.file(join(...parts)).toString();
}

suite("links and images resolve against the document's folder and repository", () => {
  /** A new folder holding `.git` and `guide/page.md`; returns the folder and the page. */
  function repository(): { root: string; page: vscode.Uri } {
    const root = mkdtempSync(join(tmpdir(), "wysidown-"));
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "guide"));
    writeFileSync(join(root, "guide", "page.md"), "# Page\n");
    return { root, page: vscode.Uri.file(join(root, "guide", "page.md")) };
  }

  test("the root is the nearest folder above the document that holds .git", async () => {
    const { root, page } = repository();
    const folder = await folderOf(page);
    assert.ok(folder);
    assert.equal(folder.dir.toString(), file(root, "guide"));
    assert.equal(folder.root.toString(), file(root));
  });

  test("outside a repository the root is the document's folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wysidown-"));
    const folder = await folderOf(vscode.Uri.file(join(dir, "page.md")));
    assert.equal(folder?.root.toString(), file(dir));
  });

  test("an untitled document has no folder", async () => {
    assert.equal(await folderOf(vscode.Uri.parse("untitled:Untitled-1")), null);
  });

  test("a link to a markdown file opens it relative to the document, or to the root with a leading slash", async () => {
    const { root, page } = repository();
    const folder = await folderOf(page);
    const open = (href: unknown) => linkedFile({ type: "open", href }, folder)?.toString();
    assert.equal(open("docs/install.md"), file(root, "guide", "docs", "install.md"));
    assert.equal(open("../README.md#usage"), file(root, "README.md"));
    assert.equal(open("/CHANGELOG.md"), file(root, "CHANGELOG.md"));
    assert.equal(open("docs/release%20plan.md"), file(root, "guide", "docs", "release plan.md"));
  });

  test("links to anything else, and other messages, open nothing", async () => {
    const { page } = repository();
    const folder = await folderOf(page);
    for (const href of ["https://example.com/a.md", "C:/a.md", "//server/a.md", "images/a.png", "#page", 42]) {
      assert.equal(linkedFile({ type: "open", href }, folder), null, String(href));
    }
    assert.equal(linkedFile({ type: "ready" }, folder), null);
    assert.equal(linkedFile(null, folder), null);
    assert.equal(linkedFile({ type: "open", href: "a.md" }, null), null);
  });
});
