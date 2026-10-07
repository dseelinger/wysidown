import * as assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { savePastedImage } from "../src/images.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

suite("pasted images are saved in the document's images folder", () => {
  const folder = () => mkdtempSync(join(tmpdir(), "wysidown-"));

  test("an image is written to images/image-1 with its type's extension, creating the folder", async () => {
    const dir = folder();
    assert.equal(await savePastedImage(vscode.Uri.file(dir), png), "images/image-1.png");
    assert.deepEqual(readFileSync(join(dir, "images", "image-1.png")), png);
    assert.equal(await savePastedImage(vscode.Uri.file(dir), jpeg), "images/image-1.jpg");
  });

  test("a file already there is not overwritten", async () => {
    const dir = folder();
    mkdirSync(join(dir, "images"));
    writeFileSync(join(dir, "images", "image-1.png"), "mine");
    assert.equal(await savePastedImage(vscode.Uri.file(dir), png), "images/image-2.png");
    assert.equal(readFileSync(join(dir, "images", "image-1.png"), "utf8"), "mine");
  });

  test("an existing folder named Images with other capitals is used under its own name", async () => {
    const dir = folder();
    mkdirSync(join(dir, "Images"));
    assert.equal(await savePastedImage(vscode.Uri.file(dir), png), "Images/image-1.png");
    assert.deepEqual(readdirSync(dir), ["Images"]);
  });

  test("bytes that are not an image are not written", async () => {
    const dir = folder();
    await assert.rejects(savePastedImage(vscode.Uri.file(dir), Buffer.from("<script>alert(1)</script>")));
    assert.equal(existsSync(join(dir, "images")), false);
  });

  test("an images folder that leads outside the document's folder is not written to", async () => {
    const dir = folder();
    const elsewhere = folder();
    symlinkSync(elsewhere, join(dir, "images"), "junction");
    await assert.rejects(savePastedImage(vscode.Uri.file(dir), png));
    assert.deepEqual(readdirSync(elsewhere), []);
  });
});
