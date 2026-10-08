# Changelog

Newest first. Each heading is `## <version> — <title>`; each fix commit adds one entry under
`## Unreleased`, written for the person using the editor.

## Unreleased

- Keys that format text: Ctrl+B bold, Ctrl+I italic, Ctrl+Shift+X strikethrough and Ctrl+E inline
  code turn the format on or off for the selected text, or for the text you type next when nothing
  is selected. Ctrl+1 to Ctrl+6 make the paragraph a heading of that level; pressing the key for
  the level a heading already has makes it a paragraph again. In a list item or a quote only that
  block changes. In VS Code these keys format text while Wysidown has the focus, and VS Code's own
  commands for them, such as Ctrl+B for the side bar, do not also run. Ctrl+K, which edits a link,
  no longer also starts a VS Code key chord.
- Markdown typed into the editor becomes formatting as you type it. At the start of a paragraph,
  `#` to `######` and a space make a heading; `-`, `*` or `+` and a space start a bullet list;
  `1.` or `1)` and a space start a numbered list at that number; `[ ]` or `[x]` and a space at the
  start of a list item make it a task; `>` and a space make a quote. A line holding only ` ``` `
  or `~~~`, optionally with a language, starts a code block when you press Enter, and `---`, `***`
  or `___` adds a horizontal rule. Around text, `**bold**`, `__bold__`, `*italic*`, `_italic_`,
  `` `code` `` and `~~struck~~` format the text when you type the closing marker. Backspace
  straight after a conversion takes it back and leaves what you typed. Nothing converts inside a
  code block or inline code, or while an input method is composing. New syntax is saved with the
  markers the document already uses most, and a list typed next to a list of the same kind joins
  it.
- Text typed with an input method, such as the Japanese, Chinese or Korean IME, a dead key on the
  US-International keyboard, or the emoji panel (Win+.), is entered whole. Composing inside a
  link's text no longer removes the link. In VS Code, the text you are still choosing a candidate
  for is not sent to the file; once you commit it, it joins the typing around it as one undo step.
  When the file changes outside Wysidown while you are composing, the change is shown once you
  commit the text, and the text you composed is kept unless the change was to the same paragraph.
- Find and replace, in the editor and in the desktop app's source mode. Ctrl+F opens the find
  bar and Ctrl+H opens it with a Replace box; in the desktop app they are also Edit > Find and
  Edit > Replace. The bar works as VS Code's does: Match Case (Alt+C), Match Whole Word (Alt+W)
  and Use Regular Expression (Alt+R), a count such as "3 of 12", Enter and Shift+Enter or F3 and
  Shift+F3 for the next and previous match, Replace (Enter in the Replace box, or Ctrl+Shift+1)
  and Replace All (Ctrl+Alt+Enter). A regular expression's replacement may use `$1` and `$&`.
  Escape closes the bar. A space in the search also finds a line break inside a paragraph, which
  the editor shows as a space. Text selected on one line fills the bar when it opens, and the search
  stays when the desktop app switches to or from source mode. Replace All saves only the replaced
  text, keeps bold, italic and links on it, and is undone in one step, in VS Code too.
- In VS Code, Wysidown now looks like VS Code's Markdown preview of the same file: inline code in
  the editor's monospace font, code blocks as a panel with the language label in its corner, tables
  with a rule under the header and between rows, quotes with a bar on the left, a rule under
  first-level headings, and a thin horizontal rule. Colours come from your VS Code colour theme.
  High contrast themes keep their solid borders.
- The desktop app's GitHub theme, View > Theme > GitHub, is now available. It makes a document
  look as the same file does on github.com: GitHub's text sizes, headings, tables with banded
  rows, code blocks as a rounded grey panel with GitHub's code colours, and links underlined in
  blue, in a centred column up to 980 pixels wide. It follows Windows' light or dark mode. Text is
  in Segoe UI rather than github.com's own web font.
- The desktop app has a theme setting, View > Theme. The VS Code theme, the default, makes a
  document look as it does in VS Code's Markdown preview: Segoe UI text at 14 pixels, a thin rule
  under first- and second-level headings, quotes as a shaded band with a bar on the left, inline
  code as a monospace chip, code blocks as a padded panel, and code coloured as in the preview.
  It follows Windows' light or dark mode. The choice is kept when the app restarts. The GitHub
  theme is listed but not yet available. The VS Code extension's look does not change.
- A paragraph whose lines are wrapped by hand in the file now shows as one paragraph that wraps
  at the window width, as in VS Code's Markdown preview and on GitHub. Each line break inside a
  paragraph, heading or list item shows as a space; the arrow keys step over it in one press, and
  Backspace or Delete at it joins the two lines. The file keeps its line breaks: an edit in one
  line changes only that line. Hard line breaks (two trailing spaces or a trailing backslash) and
  code blocks still show their line breaks.
- Wysidown has its own icon, a purple tile with an upside-down Markdown M and a yellow down
  arrow. It shows on the desktop app's program file, window, taskbar button, Start menu entry and
  installer, and on the extension in VS Code's Extensions view.
- The desktop app has a Windows installer, `Wysidown-Setup-0.1.0.exe`. It installs for your
  account only, without asking for administrator rights, adds Wysidown to the Start menu, and can
  be removed from Settings > Apps. Wysidown is listed under Open with for `.md` and `.markdown`
  files and can be chosen as their default program. Opening another file while Wysidown is
  running, by double-clicking it or from the command line, opens it in a new window of the
  running app. The installer is not signed, so Windows SmartScreen warns the first time it runs.
  The desktop app and the VS Code extension are now both version 0.1.0.
- The desktop app has a source mode: View > Source Mode, or Ctrl+/, shows the markdown as plain
  text and switches back again. The cursor and any selection stay on the same text in both
  directions. Text typed in source mode is saved exactly as typed, a new line takes the file's
  line ending, and a byte order mark is kept. Undo works within each mode; switching starts a new
  undo history.
- Code blocks are coloured by their language: keywords, strings, numbers, comments and similar
  parts of bash, C, C++, C#, CSS, diff, Go, HTML, Java, JavaScript, JSON, JSX, Kotlin, Markdown,
  PHP, PowerShell, Python, Ruby, Rust, SQL, Swift, TOML, TSX, TypeScript, XML and YAML. A block
  with no language, or one the editor does not know, stays plain. The colours follow the light or
  dark theme, and in a high contrast theme the text keeps its one colour. The file is not changed.
- The editor follows your theme. The desktop app is light or dark with the Windows setting, and
  a Windows contrast theme gives solid borders in its own colours. In VS Code the page, text,
  links, the link bubble and the table menu use the colours of the current colour theme, and the
  high contrast themes give solid borders and inline code without a filled background.
- Pasting an image that is only on the clipboard, such as a screenshot, a picture copied in Word,
  or an image embedded in copied web content, saves it in an `images` folder beside the markdown
  file and inserts a link to it, such as `![](images/image-1.png)`. Each pasted image gets a new
  name (`image-1.png`, `image-2.png`, …), so no file is overwritten. PNG, JPEG, GIF and WebP
  images are saved. A document that has never been saved cannot take pasted images: save it
  first. Images copied from a web page keep their web address.
- Ctrl+click on a link to a web page or an email address, or Open in the link's bubble, opens it
  in your browser or mail program. A reference link opens the address in its definition. Links
  with any other scheme, such as `file:` or `javascript:`, do not open.
- In VS Code, undo after typing in Wysidown removes the last word typed, not the last character.
  Typing reaches the file a word at a time: at each space, after a second without typing, and at
  once on Enter, a paste, a deletion of more than one character, a cursor move, a save, or any key
  pressed with Ctrl or Alt.
- Pasting keeps formatting as markdown. Content copied from a web page, Word or Google Docs keeps
  its headings, bold, italic, strikethrough, links, lists (nested and numbered), task lists, code
  and tables. Word's own formatting and empty lines are dropped. Links that run script are pasted
  as plain text.
  Text copied from a markdown file in VS Code, or plain text from any program, is read as
  markdown, so `**bold**` pastes as bold. Several lines of code copied from VS Code become a code
  block marked with the file's language. Ctrl+Shift+V pastes text exactly as written, saving
  characters such as `*` so they stay text. Content copied in Wysidown pastes back unchanged.
- Images are shown. An image path is read relative to the markdown file, and a path starting with
  `/` relative to the top of the file's git repository (or the file's folder when it is not in
  one). An image that cannot be found or read shows as a box with its alt text; hovering over the
  box shows the path. Images on your disk load only from inside that repository or folder. Images
  from the web load unless you turn them off: in the desktop app with View > Load Images from the
  Web, which is remembered, and in VS Code with the `wysidown.remoteImages` setting. While they
  are off, each shows as a box with its alt text. Ctrl+click on a link to another markdown file,
  such as `[guide](docs/install.md)`, opens that file in Wysidown; in the desktop app it replaces
  the open document, asking first if it has unsaved changes. Ctrl+click on a link to a heading in
  the same file, such as `[Usage](#usage)`, moves the cursor to that heading and scrolls it to
  the top. The box that shows a link's target has an Open button for both kinds of link.
- Links can be edited. Putting the cursor in a link shows where it goes in a box under it, with
  Edit and Remove buttons. Edit, or Ctrl+K, opens a form with the link's text and URL; Enter
  saves it and Escape closes it. Ctrl+K with text selected makes the text a link, and with nothing
  selected inserts a new one. Saving changes only the link's own markdown: a new URL replaces
  just the URL and keeps the title and the text as written, a new link adds brackets around text
  that is otherwise left alone, and Remove leaves the text without its brackets. A reference link
  such as `[guide][guide]` gets its new URL in its definition line. An autolink such as
  `<https://example.com>` keeps showing its URL when the URL changes. Links are underlined.
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
