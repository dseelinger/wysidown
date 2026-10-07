import { _electron as electron, test, type Frame } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corpus, expect, repoRoot, vscodeExecutable } from "./support.ts";

/** The table the desktop app's VS Code theme is tested against. Set WYSIDOWN_MEASURE_PREVIEW=1 to write it instead of comparing. */
const table = join(repoRoot(), "apps", "desktop", "e2e", "vscode-preview-styles.json");

const box = ["padding-top", "padding-right", "padding-bottom", "padding-left"];
const rule = (side: string) => [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`];

/** What is measured: the element the selector finds first in the preview of the document, and its computed styles. */
const entries: Record<string, { document: string; selector: string; properties: string[] }> = {
  page: { document: "26-api-docs.md", selector: "html", properties: ["background-color"] },
  body: {
    document: "26-api-docs.md",
    selector: "body",
    properties: ["font-family", "font-size", "line-height", "color", "padding-top", "padding-right", "padding-left"],
  },
  ...Object.fromEntries(
    ["h1", "h2"].map((h) => [
      h,
      {
        document: "26-api-docs.md",
        selector: h,
        properties: [
          "font-size",
          "line-height",
          "font-weight",
          "margin-top",
          "margin-bottom",
          "padding-bottom",
          ...rule("bottom"),
        ],
      },
    ]),
  ),
  h3: {
    document: "26-api-docs.md",
    selector: "h3",
    properties: ["font-size", "line-height", "font-weight", "margin-top", "margin-bottom"],
  },
  p: {
    document: "26-api-docs.md",
    selector: "p",
    properties: ["font-size", "line-height", "margin-top", "margin-bottom"],
  },
  link: { document: "35-inline-links.md", selector: "p > a", properties: ["color", "text-decoration-line"] },
  "inline code": {
    document: "26-api-docs.md",
    selector: "p > code",
    properties: ["font-family", "font-size", "line-height", "color", "background-color", ...box, "border-radius"],
  },
  "code block": {
    document: "26-api-docs.md",
    selector: "pre",
    properties: ["background-color", ...rule("top"), "border-radius", "margin-top", "margin-bottom"],
  },
  "code block padding": { document: "26-api-docs.md", selector: "pre", properties: box },
  "code block text": {
    document: "26-api-docs.md",
    selector: "pre code",
    properties: ["font-family", "font-size", "line-height", "color"],
  },
  blockquote: {
    document: "26-api-docs.md",
    selector: "blockquote",
    properties: ["background-color", ...box, "margin-left", "margin-right", ...rule("left"), "border-radius"],
  },
  "table header cell": {
    document: "26-api-docs.md",
    selector: "thead th",
    properties: ["font-weight", "text-align", ...box, ...rule("bottom")],
  },
  "table cell": {
    document: "26-api-docs.md",
    selector: "tbody > tr:first-child > td",
    properties: [...box, "border-top-width", "border-top-style"],
  },
  "table cell below a cell": {
    document: "26-api-docs.md",
    selector: "tbody > tr:nth-child(2) > td",
    properties: rule("top"),
  },
  hr: {
    document: "26-api-docs.md",
    selector: "hr",
    properties: ["height", "border-top-style", ...rule("bottom"), "margin-top", "margin-bottom"],
  },
  list: {
    document: "26-api-docs.md",
    selector: "ul",
    properties: ["padding-left", "margin-bottom", "list-style-type"],
  },
};

type Styles = Record<string, Record<string, string>>;

/** Opens `name` in VS Code's Markdown preview in `theme` at a device scale factor of 1 and returns the computed styles of `entries`. */
async function measure(name: string, theme: string): Promise<Styles> {
  const root = mkdtempSync(join(tmpdir(), "wysidown-preview-"));
  const folder = join(root, "work");
  const settings = join(root, "user-data", "User");
  mkdirSync(folder);
  mkdirSync(settings, { recursive: true });
  const path = join(folder, name);
  copyFileSync(join(corpus, name), path);
  writeFileSync(
    join(settings, "settings.json"),
    JSON.stringify({
      "workbench.startupEditor": "none",
      "security.workspace.trust.enabled": false,
      "update.mode": "none",
      "telemetry.telemetryLevel": "off",
      "workbench.colorTheme": theme,
    }),
  );
  const app = await electron.launch({
    executablePath: await vscodeExecutable(),
    args: [
      `--user-data-dir=${join(root, "user-data")}`,
      `--extensions-dir=${join(root, "extensions")}`,
      "--disable-extensions",
      "--force-device-scale-factor=1",
      "--skip-welcome",
      "--skip-release-notes",
      "--new-window",
      folder,
      path,
    ],
  });
  try {
    const window = await app.firstWindow();
    await window.locator(".monaco-editor textarea").first().waitFor();
    let preview: Frame | undefined;
    for (let attempt = 0; attempt < 60 && !preview; attempt++) {
      if (attempt % 10 === 0) {
        await window.keyboard.press("F1");
        await window.keyboard.type("Markdown: Open Preview");
        await window.waitForTimeout(500);
        await window.keyboard.press("Enter");
      }
      await window.waitForTimeout(500);
      for (const frame of window.frames()) {
        if (
          (await frame
            .locator("body.vscode-body p")
            .count()
            .catch(() => 0)) > 0
        )
          preview = frame;
      }
    }
    if (!preview) throw new Error(`the Markdown preview of ${name} did not open`);
    const wanted = Object.entries(entries).filter(([, e]) => e.document === name);
    await window.screenshot({
      path: `test-results/vscode-preview-${theme.replaceAll(" ", "-").toLowerCase()}-${name}.png`,
    });
    return await preview.evaluate((list) => {
      const styles: Record<string, Record<string, string>> = {};
      for (const [key, { selector, properties }] of list) {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`no ${selector} in the preview`);
        const computed = getComputedStyle(element);
        styles[key] = Object.fromEntries(properties.map((p) => [p, computed.getPropertyValue(p)]));
      }
      // The preview's own background is transparent; the webview shows the editor background behind it.
      const probe = document.body.appendChild(document.createElement("div"));
      probe.style.background = "var(--vscode-editor-background)";
      if (styles["page"]) styles["page"]["background-color"] = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return styles;
    }, wanted);
  } finally {
    await app.close();
  }
}

const themes = { light: "Default Light Modern", dark: "Default Dark Modern" };

test("VS Code's Markdown preview shows the styles in the desktop app's VS Code theme table, in light and dark", async () => {
  test.setTimeout(240000);
  const measured: Record<string, Styles> = {};
  for (const [scheme, theme] of Object.entries(themes)) {
    const styles: Styles = {};
    for (const name of new Set(Object.values(entries).map((e) => e.document))) {
      Object.assign(styles, await measure(name, theme));
    }
    measured[scheme] = Object.fromEntries(Object.keys(entries).map((key) => [key, styles[key]!]));
  }
  if (process.env["WYSIDOWN_MEASURE_PREVIEW"] === "1") {
    writeFileSync(table, JSON.stringify(measured, null, 2) + "\n", "utf8");
  }
  expect(measured).toEqual(JSON.parse(readFileSync(table, "utf8")));
});
