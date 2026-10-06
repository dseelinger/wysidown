# Changelog

Newest first. Each heading is `## <version> — <title>`; each fix commit adds one entry under
`## Unreleased`, written for the person using the editor.

## Unreleased

- Syntax the editor does not display as formatted text — raw HTML, front matter, footnotes, math,
  GitHub alerts and link definitions — shows as a labelled box or chip holding its markdown
  source. You cannot type inside it, and it saves exactly as it was. A link or footnote definition
  that text still refers to cannot be deleted; delete the text that refers to it first.
- Markdown is shown as formatted text you can type into. Typing changes only the characters you
  typed in the file, line breaks inside a paragraph stay where they were, and Undo puts back the
  original bytes. When the file changes outside the editor, only the blocks that changed are
  replaced and the cursor stays where it was.
