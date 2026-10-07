import { imageExtension, imageFolder } from "@wysidown/core";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type * as vscode from "vscode";

/**
 * Writes the image `bytes` into the `imageFolder` in `dir`, a `file:` folder, creating it, as
 * `image-<n>.<extension>` with the first `n` no file has. Returns the file's path relative to
 * `dir`, with `/`. Throws when the bytes are not a PNG, JPEG, GIF or WebP image, or the folder
 * leads outside `dir`.
 */
export async function savePastedImage(dir: vscode.Uri, bytes: Uint8Array): Promise<string> {
  const extension = imageExtension(bytes);
  if (extension === null) throw new Error("The clipboard does not hold a PNG, JPEG, GIF or WebP image.");
  const folder = join(dir.fsPath, imageFolder);
  await mkdir(folder, { recursive: true });
  const real = await realpath(folder);
  // On a file system that ignores case the folder may already exist as `Images`; links use its own name.
  const folderName = relative(await realpath(dir.fsPath), real);
  if (folderName.toLowerCase() !== imageFolder) {
    throw new Error(`${folder} leads outside the document's folder.`);
  }
  for (let n = 1; ; n++) {
    const name = `image-${String(n)}.${extension}`;
    try {
      await writeFile(join(real, name), bytes, { flag: "wx" });
      return `${folderName}/${name}`;
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EEXIST") throw error;
    }
  }
}
