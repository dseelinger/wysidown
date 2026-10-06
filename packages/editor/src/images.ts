import type { Resources } from "@wysidown/core";
import type { NodeViewConstructor } from "prosemirror-view";

/** Where the host has not said where images lead, none load. */
export const noResources: Resources = { base: null, root: null, remoteImages: false };

/** How an image is shown: loaded from `url`, as a placeholder because images from the web are off, or as missing. */
export type ImageSource = { kind: "load"; url: string } | { kind: "remote" } | { kind: "missing" };

/**
 * Where the image `src` loads from. A relative path resolves against the document's folder, and
 * one starting with `/` against the root; a path that leads outside the root is missing. A path
 * with any other scheme than `https`, `http` and `data:image/` is missing.
 */
export function imageSource(src: string, resources: Resources): ImageSource {
  if (/^data:image\//i.test(src)) return { kind: "load", url: src };
  const web = /^https?:/i.test(src) ? src : src.startsWith("//") ? "https:" + src : null;
  if (web !== null) return resources.remoteImages ? { kind: "load", url: web } : { kind: "remote" };
  const { base, root } = resources;
  if (src === "" || base === null || root === null || /^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith("\\")) {
    return { kind: "missing" };
  }
  try {
    const top = new URL(root).href;
    const url = src.startsWith("/") ? new URL(src.replace(/^\/+/, ""), top) : new URL(src, base);
    return url.href.startsWith(top) ? { kind: "load", url: url.href } : { kind: "missing" };
  } catch {
    return { kind: "missing" };
  }
}

/**
 * Shows an image node as the image, or as a placeholder holding its alt text when it is missing,
 * fails to load, or comes from the web while images from the web are off. `resources` is read
 * when each image is drawn.
 */
export function imageView(document: Document, resources: () => Resources): NodeViewConstructor {
  return (node) => {
    const src = node.attrs["src"] as string;
    const alt = node.attrs["alt"] as string;
    const title = node.attrs["title"] as string | null;
    const dom = document.createElement("span");
    dom.className = "image";
    const placeholder = (kind: "remote" | "missing") => {
      dom.dataset["placeholder"] = kind;
      dom.textContent = alt || src;
      dom.title = `${kind === "remote" ? "Images from the web are turned off" : "Image not found"}: ${src}`;
    };
    const source = imageSource(src, resources());
    if (source.kind === "load") {
      const image = dom.appendChild(document.createElement("img"));
      image.alt = alt;
      if (title !== null) image.title = title;
      image.addEventListener("error", () => {
        image.remove();
        placeholder("missing");
      });
      image.src = source.url;
    } else {
      placeholder(source.kind);
    }
    return { dom, ignoreMutation: () => true };
  };
}
