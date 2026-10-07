/** File extensions of markdown files, lower case. */
export const markdownExtensions: readonly string[] = ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn"];

const markdownFile = new RegExp(`\\.(?:${markdownExtensions.join("|")})$`, "i");

/**
 * The file a link to another markdown file names: the path of its target, percent-decoded,
 * without any query or fragment. Relative to the document's folder, or to the repository root when
 * it starts with `/`. Null for a target with a scheme, a drive letter or a network path, a target
 * in the same document, and a path to anything but a markdown file.
 */
export function markdownLinkPath(href: string): string | null {
  if (!relative(href)) return null;
  let path: string;
  try {
    path = decodeURIComponent(href.replace(/[?#][^]*$/, ""));
  } catch {
    return null;
  }
  return relative(path) && markdownFile.test(path) && !path.includes("\0") ? path : null;
}

/** The schemes of links that open outside the editor, in a browser or a mail program. */
export const externalSchemes: readonly string[] = ["http", "https", "mailto"];

/** True when `href` is a link to open outside the editor: its scheme is one of `externalSchemes`. */
export function isExternalLink(href: string): boolean {
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(href)?.[1];
  return scheme !== undefined && externalSchemes.includes(scheme.toLowerCase());
}

/** False for a path with a scheme or drive letter, a network path, and one starting with a backslash. */
function relative(path: string): boolean {
  return !/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[/\\]{2}/.test(path) && !path.startsWith("\\");
}
