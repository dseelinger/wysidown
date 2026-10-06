import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { WysidownApi } from "../src/extension.ts";
import { fixture, tempFile } from "./support.ts";

suite("markdown files can be reopened with Wysidown", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("Wysidown is offered for .md files without replacing the default editor", () => {
    const extension = vscode.extensions.getExtension("dseelinger.wysidown");
    assert.ok(extension);
    const json = extension.packageJSON as { contributes: { customEditors: unknown } };
    assert.deepEqual(json.contributes.customEditors, [
      {
        viewType: "wysidown.markdown",
        displayName: "Wysidown",
        selector: [{ filenamePattern: "*.md" }],
        priority: "option",
      },
    ]);
  });

  test("opening a markdown file with Wysidown shows it in an editor that loads the document", async () => {
    const extension = vscode.extensions.getExtension<WysidownApi>("dseelinger.wysidown");
    assert.ok(extension);
    const api = await extension.activate();
    const uri = tempFile("blog.md", fixture("27-blog-post.md"));
    const loaded = new Promise<vscode.TextDocument>((resolve) => {
      const subscription = api.onDidLoad((document) => {
        subscription.dispose();
        resolve(document);
      });
    });
    await vscode.commands.executeCommand("vscode.openWith", uri, "wysidown.markdown");
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab?.input instanceof vscode.TabInputCustom);
    assert.equal(tab.input.viewType, "wysidown.markdown");
    assert.equal(tab.input.uri.toString(), uri.toString());
    const document = await loaded;
    assert.equal(document.uri.toString(), uri.toString());
  });
});
