import { externalSchemes, isExternalLink, markdownLinkPath, type Resources } from "@wysidown/core";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The scheme the page loads a document's images from. Its URLs are `wysidown-file://local/` and a file path. */
export const fileScheme = "wysidown-file";

const imageTypes: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/** A document's folder, and the root that its paths starting with `/` resolve against. */
export interface Folder {
  dir: string;
  root: string;
}

/** The folder of the document at `path`; null for a document on a network share. */
export async function folderOf(path: string): Promise<Folder | null> {
  const dir = dirname(path);
  if (pathToFileURL(dir).host !== "") return null;
  return { dir, root: await repositoryRoot(dir) };
}

/** The nearest folder at or above `dir` that holds `.git`, or `dir` when there is none. */
async function repositoryRoot(dir: string): Promise<string> {
  for (let at = dir; ; at = dirname(at)) {
    if (await stat(join(at, ".git")).then(Boolean, () => false)) return at;
    if (dirname(at) === at) return dir;
  }
}

/** Where the images and links of a document in `folder` lead. */
export function resourcesOf(folder: Folder | null, remoteImages: boolean): Resources {
  return { base: folder && folderUrl(folder.dir), root: folder && folderUrl(folder.root), remoteImages };
}

function folderUrl(dir: string): string {
  return `${fileScheme}://local${pathToFileURL(dir.endsWith(sep) ? dir : dir + sep).pathname}`;
}

/**
 * Answers the page's request for `url`: the image file it names, when that file is inside
 * `folder.root` once links are followed. Anything else is not found.
 */
export async function serveImage(url: string, folder: Folder | null): Promise<Response> {
  const notFound = new Response(null, { status: 404 });
  const parsed = new URL(url);
  if (!folder || parsed.host !== "local") return notFound;
  let path: string;
  try {
    path = await realpath(fileURLToPath("file://" + parsed.pathname));
  } catch {
    return notFound;
  }
  const type = imageTypes[extname(path).slice(1).toLowerCase()];
  if (type === undefined || !inside(await realpath(folder.root), path)) return notFound;
  try {
    return new Response(await readFile(path), { headers: { "content-type": type } });
  } catch {
    return notFound;
  }
}

function inside(root: string, path: string): boolean {
  const rest = relative(root, path);
  return rest !== "" && rest !== ".." && !rest.startsWith(".." + sep) && !isAbsolute(rest);
}

/**
 * The markdown file that an `open` message from the editor names, resolved against `folder`; null
 * for any other message. `message` is untrusted.
 */
export function linkedFile(message: unknown, folder: Folder | null): string | null {
  if (!folder || typeof message !== "object" || message === null) return null;
  const m = message as { type?: unknown; href?: unknown };
  if (m.type !== "open" || typeof m.href !== "string") return null;
  const path = markdownLinkPath(m.href);
  if (path === null) return null;
  return path.startsWith("/") ? join(folder.root, path) : resolve(folder.dir, path);
}

/**
 * The web or mail address that an `open` message from the editor names, as a URL; null for any
 * other message, and for an address whose scheme is not in `externalSchemes`. `message` is untrusted.
 */
export function linkedAddress(message: unknown): string | null {
  if (typeof message !== "object" || message === null) return null;
  const m = message as { type?: unknown; href?: unknown };
  if (m.type !== "open" || typeof m.href !== "string" || !isExternalLink(m.href)) return null;
  let url: URL;
  try {
    url = new URL(m.href);
  } catch {
    return null;
  }
  return externalSchemes.includes(url.protocol.slice(0, -1)) ? url.href : null;
}
