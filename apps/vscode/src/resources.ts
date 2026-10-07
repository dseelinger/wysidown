import { externalSchemes, isExternalLink, markdownLinkPath, type Resources } from "@wysidown/core";
import * as vscode from "vscode";

/** A document's folder, and the root that its paths starting with `/` resolve against. */
export interface Folder {
  dir: vscode.Uri;
  root: vscode.Uri;
}

/** The folder of the document at `uri`; null for a document with no file. */
export async function folderOf(uri: vscode.Uri): Promise<Folder | null> {
  if (uri.scheme !== "file") return null;
  const dir = vscode.Uri.joinPath(uri, "..");
  return { dir, root: await repositoryRoot(dir) };
}

/** The nearest folder at or above `dir` that holds `.git`, or `dir` when there is none. */
async function repositoryRoot(dir: vscode.Uri): Promise<vscode.Uri> {
  for (let at = dir; ;) {
    const found = await vscode.workspace.fs.stat(vscode.Uri.joinPath(at, ".git")).then(
      () => true,
      () => false,
    );
    if (found) return at;
    const parent = vscode.Uri.joinPath(at, "..");
    if (parent.path === at.path) return dir;
    at = parent;
  }
}

/** True when the Wysidown editor loads images from the web. */
export function remoteImages(): boolean {
  return vscode.workspace.getConfiguration("wysidown").get<boolean>("remoteImages", true);
}

/** Where the images and links of a document in `folder` lead, as URLs `webview` can load. */
export function resourcesOf(webview: vscode.Webview, folder: Folder | null): Resources {
  const url = (dir: vscode.Uri) => webview.asWebviewUri(dir).toString().replace(/\/?$/, "/");
  return { base: folder && url(folder.dir), root: folder && url(folder.root), remoteImages: remoteImages() };
}

/**
 * The markdown file that an `open` message from the editor names, resolved against `folder`; null
 * for any other message. `message` is untrusted.
 */
export function linkedFile(message: unknown, folder: Folder | null): vscode.Uri | null {
  if (!folder || typeof message !== "object" || message === null) return null;
  const m = message as { type?: unknown; href?: unknown };
  if (m.type !== "open" || typeof m.href !== "string") return null;
  const path = markdownLinkPath(m.href);
  if (path === null) return null;
  return vscode.Uri.joinPath(path.startsWith("/") ? folder.root : folder.dir, path);
}

/**
 * The web or mail address that an `open` message from the editor names; null for any other message,
 * and for an address whose scheme is not in `externalSchemes`. `message` is untrusted.
 */
export function linkedAddress(message: unknown): vscode.Uri | null {
  if (typeof message !== "object" || message === null) return null;
  const m = message as { type?: unknown; href?: unknown };
  if (m.type !== "open" || typeof m.href !== "string" || !isExternalLink(m.href)) return null;
  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(m.href, true);
  } catch {
    return null;
  }
  const scheme = uri.scheme.toLowerCase();
  return externalSchemes.includes(scheme) ? uri.with({ scheme }) : null;
}
