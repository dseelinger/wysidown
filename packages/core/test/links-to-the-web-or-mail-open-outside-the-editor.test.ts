import { describe, expect, test } from "vitest";
import { isExternalLink } from "../src/index.ts";

describe("links to the web or mail open outside the editor", () => {
  test.each([
    "https://example.com/docs",
    "http://www.example.com",
    "HTTPS://EXAMPLE.COM/",
    "mailto:someone@example.com",
    "MailTo:someone@example.com?subject=Hello",
  ])("%s opens outside the editor", (href) => {
    expect(isExternalLink(href)).toBe(true);
  });

  test.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "file:///C:/Windows/notepad.exe",
    "data:text/html,<p>x</p>",
    "vbscript:msgbox",
    "ms-settings:privacy",
    "vscode://file/C:/a.md",
    " https://example.com",
    "https//example.com",
    "docs/install.md",
    "#further-reading",
    "",
  ])("%s does not", (href) => {
    expect(isExternalLink(href)).toBe(false);
  });
});
