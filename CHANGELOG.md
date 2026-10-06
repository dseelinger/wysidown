# Changelog

Newest first. Each heading is `## <version> — <title>`; each fix commit adds one entry under
`## Unreleased`, written for the person using the editor.

## Unreleased

- Code blocks keep their fences when edited. Saving after typing in a code block rewrites only the
  lines you changed: the fence (backticks or tildes, and how many), its indentation, the info
  string and the other lines stay as they were, and a new line inside a quote or list item gets
  the same `>` or indentation as the lines beside it. Each code block has a language box above
  it; typing a language there, or picking one from its suggestions, and pressing Enter changes
  only the language in the opening fence, keeping anything written after it such as
  `title="example.py"`. Clearing the box removes the language. Giving an indented code block a
  language turns it into a fenced block in the same place. Tab in a code block types a tab, and
  with several lines selected Tab and Shift+Tab add or remove a tab at the start of each; tabs
  are saved as tabs and shown four columns wide. Enter in a code block inside a list item starts a
  new line of code instead of a new list item.
- Tables can be edited. Tab and Shift+Tab move between cells, and Tab in the last cell adds a
  row; Enter moves to the cell below, adding a row at the end of the table. Right-clicking a
  cell, or pressing the menu key or Shift+F10 in one, opens a menu that inserts and deletes rows
  and columns and sets a column's alignment. Saving rewrites only the rows and cells you changed:
  the others keep their spacing, padding and pipes exactly as they were. A new row or column is
  written the way the table already is, with or without pipes at the ends of each line, and
  padded to the column widths when the table is padded; a `|` typed into a cell is saved as `\|`.
  Pasting into a cell keeps the pasted text on one line. The header row shows in bold, and each
  column shows its alignment.
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
