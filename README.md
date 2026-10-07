# wysidown

A WYSIWYG editor for GitHub Flavored Markdown, shipped as a Windows desktop app and as a VS Code
extension from one codebase. Text you do not edit is saved byte for byte, so a one-word change is
a one-word diff.

Status: project skeleton. Nothing edits yet. Work is tracked in
[GitHub issues](https://github.com/dseelinger/wysidown/issues), one at a time.

## Building

Requires Node 24.13.0 and pnpm 12.9.1 exactly (`.node-version`, `packageManager`).

```sh
pnpm install
pnpm gate
```

`pnpm gate` runs every check and builds both packages. See `CLAUDE.md` for the full list of
commands.

`pnpm local` builds and packages both apps, then installs the extension into the VS Code whose
`code` command is on PATH. It prints where the desktop app is,
`apps/desktop/release/win-unpacked/Wysidown.exe`, and the extension version it installed. Close
`Wysidown.exe` first; reload open VS Code windows afterwards.

## License

MIT. See `LICENSE` and `NOTICE`.
