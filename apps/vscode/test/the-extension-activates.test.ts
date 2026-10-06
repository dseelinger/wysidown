import * as assert from "node:assert/strict";
import * as vscode from "vscode";

suite("the extension activates", () => {
  test("activating the extension succeeds", async () => {
    const extension = vscode.extensions.getExtension("dseelinger.wysidown");
    assert.ok(extension, "extension dseelinger.wysidown is installed");
    await extension.activate();
    assert.equal(extension.isActive, true);
  });
});
