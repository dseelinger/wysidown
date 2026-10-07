import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, repoRoot, test } from "./support.ts";

/** Computed styles measured in VS Code's Markdown preview, by colour scheme and entry. */
const preview = JSON.parse(
  readFileSync(join(repoRoot(), "apps", "desktop", "e2e", "vscode-preview-styles.json"), "utf8"),
) as Record<string, Record<string, Record<string, string>>>;

/** Where each measured entry is in the editor: the document, and the first element the selector finds. */
const places: Record<string, { document: string; selector: string }> = {
  page: { document: "26-api-docs.md", selector: "body" },
  body: { document: "26-api-docs.md", selector: "body" },
  h1: { document: "26-api-docs.md", selector: ".ProseMirror h1" },
  h2: { document: "26-api-docs.md", selector: ".ProseMirror h2" },
  h3: { document: "26-api-docs.md", selector: ".ProseMirror h3" },
  p: { document: "26-api-docs.md", selector: ".ProseMirror > p" },
  link: { document: "35-inline-links.md", selector: ".ProseMirror p > a" },
  "inline code": { document: "26-api-docs.md", selector: ".ProseMirror p > code" },
  "code block": { document: "26-api-docs.md", selector: ".ProseMirror .code-block" },
  "code block padding": { document: "26-api-docs.md", selector: ".ProseMirror .code-block pre" },
  "code block text": { document: "26-api-docs.md", selector: ".ProseMirror .code-block pre code" },
  blockquote: { document: "26-api-docs.md", selector: ".ProseMirror blockquote" },
  "table header cell": { document: "26-api-docs.md", selector: ".ProseMirror tr:first-child > td" },
  "table cell": { document: "26-api-docs.md", selector: ".ProseMirror tr:nth-child(2) > td" },
  "table cell below a cell": { document: "26-api-docs.md", selector: ".ProseMirror tr:nth-child(3) > td" },
  hr: { document: "26-api-docs.md", selector: ".ProseMirror hr" },
  list: { document: "26-api-docs.md", selector: ".ProseMirror ul" },
};

const themes = { light: "Default Light Modern", dark: "Default Dark Modern" };

for (const [scheme, theme] of Object.entries(themes)) {
  test(`in ${theme}, Wysidown shows the styles of VS Code's Markdown preview`, async ({ open }) => {
    test.setTimeout(120000);
    const expected = preview[scheme]!;
    expect(Object.keys(places).sort()).toEqual(Object.keys(expected).sort());
    const actual: Record<string, Record<string, string>> = {};
    for (const name of new Set(Object.values(places).map((p) => p.document))) {
      const o = await open(name, {
        settings: { "workbench.colorTheme": theme },
        args: ["--force-device-scale-factor=1"],
      });
      await expect(o.editor.locator("body")).toHaveClass(/\bwysidown-theme-vscode\b/);
      const wanted = Object.entries(places)
        .filter(([, p]) => p.document === name)
        .map(([key, { selector }]) => ({ key, selector, properties: Object.keys(expected[key]!) }));
      Object.assign(
        actual,
        await o.editor.evaluate((list) => {
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
      await o.window.screenshot({ path: `test-results/wysidown-vscode-${scheme}-${name.replace(".md", "")}.png` });
    }
    expect(actual).toEqual(expected);
  });
}
