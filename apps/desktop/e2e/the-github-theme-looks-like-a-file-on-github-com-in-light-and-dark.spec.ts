import { test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyFixture, expect, launch, newFolder, quit, userDataArgument } from "./support.ts";

/**
 * Computed styles of the same corpus documents viewed on github.com, by colour scheme and entry,
 * measured with each selector's `github` counterpart. Border widths are as at 100% scale.
 */
const github = JSON.parse(readFileSync(join(import.meta.dirname, "github-styles.json"), "utf8")) as Record<
  string,
  Record<string, Record<string, string>>
>;

/** github.com loads its Mona Sans font from the web; the app uses the system fonts that follow it in the list. */
const differences: Record<string, Record<string, string>> = {
  body: {
    "font-family":
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  },
};

/** Where each entry is in the desktop app, and where it was measured on github.com. */
const places: Record<string, { document: string; selector: string; github: string }> = {
  page: { document: "26-api-docs.md", selector: "body", github: "body" },
  body: { document: "26-api-docs.md", selector: "#editor", github: "article.markdown-body" },
  h1: { document: "26-api-docs.md", selector: ".ProseMirror h1", github: "article h1" },
  h2: { document: "26-api-docs.md", selector: ".ProseMirror h2", github: "article h2" },
  h3: { document: "26-api-docs.md", selector: ".ProseMirror h3", github: "article h3" },
  p: { document: "26-api-docs.md", selector: ".ProseMirror > p", github: "article > p" },
  link: { document: "35-inline-links.md", selector: ".ProseMirror p > a", github: "article p > a" },
  "inline code": { document: "26-api-docs.md", selector: ".ProseMirror p > code", github: "article p > code" },
  "code block": { document: "26-api-docs.md", selector: ".ProseMirror .code-block", github: "article .highlight" },
  "code block panel": {
    document: "26-api-docs.md",
    selector: ".ProseMirror .code-block pre",
    github: "article .highlight pre",
  },
  "code keyword": {
    document: "26-api-docs.md",
    selector: ".ProseMirror .code-block .hljs-keyword",
    github: "article .highlight pre .pl-k",
  },
  "code string": {
    document: "26-api-docs.md",
    selector: ".ProseMirror .code-block .hljs-string",
    github: "article .highlight pre .pl-s",
  },
  blockquote: { document: "26-api-docs.md", selector: ".ProseMirror blockquote", github: "article blockquote" },
  table: { document: "26-api-docs.md", selector: ".ProseMirror table", github: "article table" },
  "table header cell": {
    document: "26-api-docs.md",
    selector: ".ProseMirror tr:first-child > td",
    github: "article th",
  },
  "table cell": {
    document: "26-api-docs.md",
    selector: ".ProseMirror tr:nth-child(2) > td",
    github: "article tbody tr:nth-child(1) > td",
  },
  "table first row": {
    document: "26-api-docs.md",
    selector: ".ProseMirror tr:nth-child(2)",
    github: "article tbody tr:nth-child(1)",
  },
  "table second row": {
    document: "26-api-docs.md",
    selector: ".ProseMirror tr:nth-child(3)",
    github: "article tbody tr:nth-child(2)",
  },
  hr: { document: "26-api-docs.md", selector: ".ProseMirror hr", github: "article hr" },
  list: { document: "26-api-docs.md", selector: ".ProseMirror > ul", github: "article > ul" },
};

/** The layout the package's README gives for a page that is only markdown. */
const layout = { "max-width": "980px", "padding-top": "45px", "padding-left": "45px" };

/** The argument that starts the app with the GitHub theme and images from the web turned off. */
function githubTheme(): string {
  const folder = newFolder();
  writeFileSync(join(folder, "settings.json"), JSON.stringify({ remoteImages: false, theme: "github" }));
  return userDataArgument(folder);
}

for (const scheme of ["light", "dark"] as const) {
  test(`with Windows in ${scheme} mode, the GitHub theme shows the styles of the file on github.com`, async () => {
    const expected = github[scheme]!;
    expect(Object.keys(places).sort()).toEqual(Object.keys(expected).sort());
    const actual: Record<string, Record<string, string>> = {};
    for (const name of new Set(Object.values(places).map((p) => p.document))) {
      const { app, window, errors } = await launch(githubTheme(), "--force-device-scale-factor=1", copyFixture(name));
      try {
        await window.emulateMedia({ colorScheme: scheme });
        await expect(window.locator("body")).toHaveClass(/\bwysidown-theme-github\b/);
        await expect(window.locator(".ProseMirror")).toBeVisible();
        await expect
          .poll(() => window.evaluate(() => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")))
          .toBe(scheme);
        const wanted = Object.entries(places)
          .filter(([, p]) => p.document === name)
          .map(([key, { selector }]) => ({ key, selector, properties: Object.keys(expected[key]!) }));
        Object.assign(
          actual,
          await window.evaluate((list) => {
            const styles: Record<string, Record<string, string>> = {};
            for (const { key, selector, properties } of list) {
              const element = document.querySelector(selector);
              if (!element) throw new Error(`no ${selector} in the editor`);
              const computed = getComputedStyle(element);
              styles[key] = Object.fromEntries(properties.map((p) => [p, computed.getPropertyValue(p)]));
            }
            return styles;
          }, wanted),
        );
        if (name === "26-api-docs.md") {
          const root = await window.evaluate((properties) => {
            const computed = getComputedStyle(document.querySelector("#editor")!);
            return Object.fromEntries(properties.map((p) => [p, computed.getPropertyValue(p)]));
          }, Object.keys(layout));
          expect(root).toEqual(layout);
        }
        await window.screenshot({ path: `test-results/github-theme-${scheme}-${name.replace(".md", "")}.png` });
        expect(errors).toEqual([]);
      } finally {
        await quit(app);
      }
    }
    const want = Object.fromEntries(
      Object.entries(expected).map(([key, styles]) => [key, { ...styles, ...differences[key] }]),
    );
    expect(actual).toEqual(want);
  });
}
