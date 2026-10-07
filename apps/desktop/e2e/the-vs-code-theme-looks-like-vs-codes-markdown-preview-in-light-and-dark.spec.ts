import { test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copyFixture, expect, launch, offline, quit } from "./support.ts";

/** Computed styles measured in VS Code's Markdown preview by the extension's end-to-end tests, by colour scheme and entry. */
const preview = JSON.parse(readFileSync(join(import.meta.dirname, "vscode-preview-styles.json"), "utf8")) as Record<
  string,
  Record<string, Record<string, string>>
>;

/** Where each measured entry is in the desktop app: the document, and the first element the selector finds. */
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

for (const scheme of ["light", "dark"] as const) {
  test(`with Windows in ${scheme} mode, the VS Code theme shows the styles of VS Code's Markdown preview`, async () => {
    const expected = preview[scheme]!;
    expect(Object.keys(places).sort()).toEqual(Object.keys(expected).sort());
    const actual: Record<string, Record<string, string>> = {};
    for (const name of new Set(Object.values(places).map((p) => p.document))) {
      const { app, window, errors } = await launch(offline(), "--force-device-scale-factor=1", copyFixture(name));
      try {
        await window.emulateMedia({ colorScheme: scheme });
        await expect(window.locator("body")).toHaveClass(/\bwysidown-theme-vscode\b/);
        await expect(window.locator(".ProseMirror")).toBeVisible();
        const wanted = Object.entries(places)
          .filter(([, p]) => p.document === name)
          .map(([key, { selector }]) => ({ key, selector, properties: Object.keys(expected[key]!) }));
        await expect
          .poll(() => window.evaluate(() => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")))
          .toBe(scheme);
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
        await window.screenshot({ path: `test-results/vscode-theme-${scheme}-${name.replace(".md", "")}.png` });
        expect(errors).toEqual([]);
      } finally {
        await quit(app);
      }
    }
    expect(actual).toEqual(expected);
  });
}
