import type { Page } from "@playwright/test";
import { caret, expect, load, test } from "./support.ts";

const sample = [
  "# Themes",
  "",
  "Read [the docs](https://example.com/docs) before the `build` step, then [`parse`](./parse.ts).",
  "",
  "```ts",
  'const theme = "dark";',
  "```",
  "",
  "| Mode | Source |",
  "| ---- | ------ |",
  "| VS Code | `--vscode-*` |",
  "",
  "- [x] light",
  "- [ ] dark",
  "",
  "<details>raw html</details>",
  "",
].join("\n");

/** The computed value of `property` on the first element matching `selector`. */
async function style(page: Page, selector: string, property: string): Promise<string> {
  return page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s)!).getPropertyValue(p), [
    selector,
    property,
  ] as const);
}

/** Opens the link popover and takes a screenshot named `name`. */
async function capture(page: Page, name: string): Promise<void> {
  await caret(page, "the docs");
  await expect(page.getByRole("dialog", { name: "Link" })).toBeVisible();
  await page.screenshot({ path: `test-results/theme-${name}.png` });
}

test("in a light system theme the editor is dark text on a light page", async ({ harness: page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await load(page, sample);
  expect(await style(page, "body", "background-color")).toBe("rgb(255, 255, 255)");
  expect(await style(page, "body", "color")).toBe("rgb(0, 0, 0)");
  await capture(page, "light");
  expect(await style(page, ".link-popover", "background-color")).toBe("rgb(255, 255, 255)");
});

test("in a dark system theme the page, text, link and popover are dark", async ({ harness: page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await load(page, sample);
  expect(await style(page, "body", "background-color")).toBe("rgb(18, 18, 18)");
  expect(await style(page, "body", "color")).toBe("rgb(255, 255, 255)");
  expect(await style(page, ".ProseMirror a", "color")).not.toBe("rgb(0, 0, 238)");
  expect(await style(page, ".ProseMirror li.task > input", "color-scheme")).toBe("light dark");
  await capture(page, "dark");
  expect(await style(page, ".link-popover", "background-color")).toBe("rgb(18, 18, 18)");
  expect(await style(page, ".link-popover", "color")).toBe("rgb(255, 255, 255)");
});

test("in a high contrast system theme borders are solid in the text colour", async ({ harness: page }) => {
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
  await load(page, sample);
  const text = await style(page, "body", "color");
  expect(await style(page, ".ProseMirror .code-block", "border-top-color")).toBe(text);
  expect(await style(page, ".ProseMirror .raw", "border-top-color")).toBe(text);
  await capture(page, "high-contrast");
  expect(await style(page, ".link-popover", "border-top-color")).toBe(text);
});

test("in VS Code the editor takes its colours from the theme's variables", async ({ harness: page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => {
    const root = document.documentElement.style;
    root.setProperty("--vscode-editor-background", "rgb(30, 30, 46)");
    root.setProperty("--vscode-editor-foreground", "rgb(205, 214, 244)");
    root.setProperty("--vscode-textLink-foreground", "rgb(137, 180, 250)");
    root.setProperty("--vscode-editorWidget-background", "rgb(24, 24, 37)");
    root.setProperty("--vscode-editorWidget-foreground", "rgb(186, 194, 222)");
    root.setProperty("--vscode-editorWidget-border", "rgb(69, 71, 90)");
    document.body.classList.add("vscode-dark");
  });
  await load(page, sample);
  expect(await style(page, "body", "background-color")).toBe("rgb(30, 30, 46)");
  expect(await style(page, "body", "color")).toBe("rgb(205, 214, 244)");
  expect(await style(page, "body", "color-scheme")).toBe("dark");
  expect(await style(page, ".ProseMirror a", "color")).toBe("rgb(137, 180, 250)");
  await capture(page, "vscode-dark");
  expect(await style(page, ".link-popover", "background-color")).toBe("rgb(24, 24, 37)");
  expect(await style(page, ".link-popover", "color")).toBe("rgb(186, 194, 222)");
  expect(await style(page, ".link-popover", "border-top-color")).toBe("rgb(69, 71, 90)");
});

test("in a VS Code high contrast theme borders take the contrast border colour and code is not filled", async ({
  harness: page,
}) => {
  await page.evaluate(() => {
    const root = document.documentElement.style;
    root.setProperty("--vscode-editor-background", "rgb(0, 0, 0)");
    root.setProperty("--vscode-editor-foreground", "rgb(255, 255, 255)");
    root.setProperty("--vscode-contrastBorder", "rgb(111, 195, 223)");
    root.setProperty("--vscode-contrastActiveBorder", "rgb(243, 129, 25)");
    document.body.classList.add("vscode-high-contrast");
    const preformat = new CSSStyleSheet();
    preformat.replaceSync("code { color: rgb(0, 0, 128); background-color: rgb(0, 0, 128); }");
    document.adoptedStyleSheets = [preformat];
  });
  await load(page, sample);
  expect(await style(page, "body", "color-scheme")).toBe("dark");
  expect(await style(page, ".ProseMirror .code-block", "border-top-color")).toBe("rgb(111, 195, 223)");
  expect(await style(page, ".ProseMirror a code", "background-color")).toBe("rgba(0, 0, 0, 0)");
  expect(await style(page, ".ProseMirror a code", "color")).toBe(await style(page, ".ProseMirror a", "color"));
  await capture(page, "vscode-high-contrast");
  expect(await style(page, ".link-popover", "border-top-color")).toBe("rgb(111, 195, 223)");
});
