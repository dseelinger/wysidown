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

## License

MIT. See `LICENSE` and `NOTICE`.
