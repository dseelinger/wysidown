import { expect, test } from "./support.ts";

const themes = [
  { theme: "Default Light Modern", scheme: "light", contrast: false },
  { theme: "Default Dark Modern", scheme: "dark", contrast: false },
  { theme: "Default High Contrast", scheme: "dark", contrast: true },
  { theme: "Default High Contrast Light", scheme: "light", contrast: true },
];

for (const { theme, scheme, contrast } of themes) {
  test(`in ${theme} the editor's page and text take the theme's editor colours`, async ({ open }) => {
    const o = await open("35-inline-links.md", { settings: { "workbench.colorTheme": theme } });
    const colours = await o.editor.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.background = "var(--vscode-editor-background)";
      probe.style.color = "var(--vscode-editor-foreground)";
      document.body.append(probe);
      const expected = getComputedStyle(probe);
      const body = getComputedStyle(document.body);
      const link = document.querySelector(".ProseMirror a")!;
      const code = getComputedStyle(document.querySelector(".ProseMirror a code")!);
      const result = {
        background: body.backgroundColor,
        foreground: body.color,
        scheme: body.colorScheme,
        expectedBackground: expected.backgroundColor,
        expectedForeground: expected.color,
        codeColour: code.color,
        codeBackground: code.backgroundColor,
        linkColour: getComputedStyle(link).color,
      };
      probe.remove();
      return result;
    });
    expect(colours.background).toBe(colours.expectedBackground);
    expect(colours.foreground).toBe(colours.expectedForeground);
    expect(colours.scheme).toBe(scheme);
    if (contrast) {
      expect(colours.codeBackground).toBe("rgba(0, 0, 0, 0)");
      expect(colours.codeColour).toBe(colours.linkColour);
    }
    await o.window.screenshot({ path: `test-results/vscode-theme-${theme.replaceAll(" ", "-").toLowerCase()}.png` });
  });
}
