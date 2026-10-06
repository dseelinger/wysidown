# Changelog

Newest first. Each heading is `## <version> — <title>`; each fix commit adds one entry under
`## Unreleased`, written for the person using the editor.

## Unreleased

- In VS Code, the last characters typed are no longer lost when the Wysidown tab is hidden or
  closed straight afterwards. Switching to another tab, or closing one of two Wysidown tabs showing
  the same file, could drop everything typed after the first character of a quick burst, and
  saving afterwards could not bring it back.
- Saving straight after typing saves everything typed. In VS Code, Ctrl+S pressed a moment after
  the last keystroke could save the file without the last few characters and leave it marked as
  changed; the Windows app could do the same, and could close without asking about changes typed
  just before closing.
- Lists can be edited from the keyboard. Enter adds an item, and Enter on an empty item moves it
  out of a nested list or ends the list; Tab nests an item under the one above and Shift+Tab
  moves it back out. A new item is written the way its list already is: the same bullet (`-`,
  `*` or `+`), the same `.` or `)` after a number, numbers that count on (or stay all `1.` in a
  list numbered that way), and the same spacing after the marker. Task items show a checkbox;
  clicking it, or pressing Space on it, changes only the space or `x` between the brackets, and
  Enter after a task adds an unchecked one. Tight lists show their items close together, as
  GitHub does.
- In VS Code, a `.md` file can be opened in Wysidown with **Reopen Editor With… › Wysidown**; the
  ordinary text editor stays the default. Edits made in Wysidown change only the characters you
  typed. Undo, redo and save are VS Code's own, the file keeps its line endings and byte order
  mark, and a change made in another editor of the same file shows in Wysidown straight away.
- An empty file, a file holding only blank lines, and a new untitled document can be typed
  into. Deleting everything in a document leaves an empty line to type on, and saves an empty
  file.
- The Windows app opens a markdown file chosen with File > Open (Ctrl+O), named on the command
  line, or dropped on the window, and saves it with File > Save (Ctrl+S) or Save As
  (Ctrl+Shift+S). Saving writes only the characters you changed and keeps the file's line endings
  and byte order mark. A dot before the file name in the title bar shows unsaved changes; opening
  another file or closing the window asks whether to save them first. A file that is not UTF-8 is
  not opened, so it cannot be changed by saving.
- Syntax the editor does not display as formatted text — raw HTML, front matter, footnotes, math,
  GitHub alerts and link definitions — shows as a labelled box or chip holding its markdown
  source. You cannot type inside it, and it saves exactly as it was. A link or footnote definition
  that text still refers to cannot be deleted; delete the text that refers to it first.
- Markdown is shown as formatted text you can type into. Typing changes only the characters you
  typed in the file, line breaks inside a paragraph stay where they were, and Undo puts back the
  original bytes. When the file changes outside the editor, only the blocks that changed are
  replaced and the cursor stays where it was.
