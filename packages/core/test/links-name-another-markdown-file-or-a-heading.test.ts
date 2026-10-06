import { describe, expect, test } from "vitest";
import { headingAnchors, markdownLinkPath, parseMarkdown } from "../src/index.ts";

describe("a link names another markdown file", () => {
  test.each([
    ["docs/install.md", "docs/install.md"],
    ["./FAQ.md#common-errors", "./FAQ.md"],
    ["../README.markdown?plain=1", "../README.markdown"],
    ["/CHANGELOG.md", "/CHANGELOG.md"],
    ["docs/release%20plan.md", "docs/release plan.md"],
    ["docs/meeting notes.MD", "docs/meeting notes.MD"],
  ])("%s names %s", (href, path) => {
    expect(markdownLinkPath(href)).toBe(path);
  });

  test.each([
    "#further-reading",
    "https://example.com/docs.md",
    "file:///C:/docs/install.md",
    "C:/docs/install.md",
    "C%3A/docs/install.md",
    "//server/share/install.md",
    "/%2Fserver/share/install.md",
    "\\\\server\\share\\install.md",
    "\\docs\\install.md",
    "images/pipeline.png",
    "docs/",
    "docs/broken%E0.md",
    "docs/nul%00.md",
  ])("%s names none", (href) => {
    expect(markdownLinkPath(href)).toBeNull();
  });
});

describe("a heading has the anchor GitHub gives it", () => {
  const anchors = (text: string) => [...headingAnchors(parseMarkdown(text).doc).keys()];

  test("text is lower-cased, spaces become hyphens and punctuation is dropped", () => {
    expect(anchors("# Getting Started\n\n## What's new in 2.0?\n\n### `parse()` & `serialize()`\n")).toEqual([
      "getting-started",
      "whats-new-in-20",
      "parse--serialize",
    ]);
  });

  test("letters outside ASCII, hyphens and underscores are kept", () => {
    expect(anchors("# Über_alles -- Résumé\n")).toEqual(["über_alles----résumé"]);
  });

  test("a repeated anchor is numbered from one", () => {
    expect(anchors("# Notes\n\n# Notes\n\n# Notes\n\n# Notes 1\n")).toEqual([
      "notes",
      "notes-1",
      "notes-2",
      "notes-1-1",
    ]);
  });

  test("headings inside quotes and lists have anchors, and their position is the heading's", () => {
    const { doc } = parseMarkdown("Intro\n\n> # Quoted\n\n- ## Listed\n");
    const found = headingAnchors(doc);
    expect([...found.keys()]).toEqual(["quoted", "listed"]);
    for (const [, pos] of found) expect(doc.nodeAt(pos)?.type.name).toBe("heading");
  });
});
