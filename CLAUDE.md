# CLAUDE.md

## What wysidown is

A WYSIWYG editor for GitHub Flavored Markdown, shipped two ways from one codebase: a Windows
desktop app (Electron) and a VS Code extension (Custom Text Editor API). Its defining property is
fidelity: text the user did not edit is saved byte for byte. MIT; GFM spec fixtures under
CC-BY-SA 4.0 (`NOTICE`). The foundation was chosen by the spike in `docs/spikes/roundtrip.md`.

## Writing style

Mannered prose substitutes metaphor and flourish for direct statement. Instead
of "a parameter worth varying," the mannered writer produces "a dial worth
turning." Instead of "this point still matters," they write "this point earns
its keep." The phrases exist to display the writer, not to convey the idea,
and readers can tell. That is why mannered prose irritates: it makes the
reader work harder so the writer can perform. It is also imprecise. Metaphors
drag in connotations the writer did not choose and cannot control. The fix is
to say what you mean. When a literal phrase is available, use it.

Apply this to comments, commit messages, docstrings, and any prose you write
— not to code identifiers or established technical terms.

## When to stop

Keep going when a step needs no input. Stop first before anything that leaves this checkout: a
push, any GitHub write (issues, comments, labels, releases, pull requests), a Marketplace publish,
or a file outside the repo. Tool caches (pnpm store, Electron download cache) are the exception.

Work is tracked as GitHub issues, taken one at a time. No parallel development; commits go to
`main`.

## Build and test

```
pnpm install
pnpm test:fast -t "corpus"              # core + editor unit tests, filtered: the working loop
pnpm vitest run --project core          # one project
pnpm gate                               # the release gate, local only, no CI
```

`pnpm gate` (`scripts/gate.mjs`) runs, stopping at the first failure: toolchain check → frozen
install → `prettier --check` → `eslint --max-warnings 0` → `tsc -b` → all Vitest projects → build
→ end-to-end tests (editor harness in Edge, desktop app in Electron, extension in VS Code) →
`vsce package` and `electron-builder --dir`.

- **Pinned toolchain.** Node `24.13.0` (`.node-version`) and pnpm `12.9.1` (`packageManager`),
  checked exactly by `scripts/check-toolchain.mjs`. Every dependency is pinned to an exact version
  (`savePrefix: ""`). Electron `44.5.1`. The extension declares `engines.vscode ^1.125.0` with
  `@types/vscode` `1.125.0` and is tested against VS Code `1.140.0` (`apps/vscode/.vscode-test.mjs`).
- **TypeScript is 6.0.3**, not 7: typescript-eslint supports `<6.1`, and the layering test uses the
  compiler API.
- **Warnings are errors.** Strict TypeScript (`tsconfig.base.json`); typescript-eslint
  `strictTypeChecked` and `stylisticTypeChecked` with `--max-warnings 0`; Vite and esbuild builds
  throw on any warning; `vitest.setup.ts` fails a test that calls `console.warn` or `console.error`;
  Playwright tests fail on any console error, warning or page error.
- **Supply chain.** pnpm runs dependency build scripts only for packages allowed in
  `pnpm-workspace.yaml` (`allowBuilds`), and refuses versions published too recently. Pin an older
  version rather than adding a release-age exemption.
- **Downloads on first run:** the Electron binary (into its cache), VS Code (into
  `apps/vscode/.vscode-test/`). The editor harness runs in the installed Microsoft Edge
  (`channel: "msedge"`) because Playwright 1.63 cannot download its Chromium here; Edge follows
  Windows Update, so it is the one unpinned part of the gate.
- Packages are not compiled by `tsc`; it only type-checks (`emitDeclarationOnly`). Vite bundles the
  editor, esbuild bundles the Electron main process and the extension.

## The layering rule

- **`packages/core`** has no DOM and no host. Its `tsconfig.json` has `lib: ["ES2023"]` and
  `types: []`, so using `document` or a Node global is a compile error.
- **`packages/editor`** may use the DOM. It imports no host.
- **`apps/desktop`** and **`apps/vscode`** are the only places that import `electron`, `vscode` or
  Node built-ins. Core declares the interfaces the hosts implement.

Enforced by `packages/core/test/the-core-and-editor-import-no-host.test.ts`, which reads every
import, re-export, import type, dynamic import, `require` and type reference in core and editor
source with the TypeScript compiler API, fails on `vscode`, `electron`, `node:*` and every Node
built-in, and also checks their `package.json` files. It includes a test that the scanner itself
reports each of those forms. The rule is what lets the editor logic run headless against the
markdown corpus.

## The fidelity rule

Unedited bytes never change. The serializer copies the original source for every node the user did
not touch and re-serializes only what changed, verifying each result by re-parsing it
(`docs/spikes/roundtrip.md`, section 2). A change that rewrites bytes outside the edit is a bug,
unless markdown cannot express the edit otherwise; those cases are listed in the tests.

Fixtures in `packages/core/test/corpus/` are compared byte for byte. `.gitattributes` stores them
with no line-ending conversion, and `the-corpus-keeps-its-bytes.test.ts` fails if a checkout gave
them CRLF. CRLF, BOM and no-final-newline variants are generated by the tests, not stored.

## House conventions

### Comments are terse

State what the code does and any constraint a caller must respect. Nothing else.

- No decision logs: do not record why an alternative was rejected or what the design used to be.
- No historical commentary ("this used to…", "no longer…").
- One-line doc comments on public members where the name is not enough.
- Issue numbers only where they carry live information.

If a constraint needs explaining, prefer a test that fails when it is broken.

### Tests are named as behavioural sentences

Test titles and test file names say what is true: `an unedited document saves to the same bytes`,
`the-core-and-editor-import-no-host.test.ts`. Not `serialize_noEdits_returnsInput`.

### One changelog entry per fix commit

`CHANGELOG.md`, newest first, `## <version> — <title>`. Each fix commit adds one entry under
`## Unreleased`, written for the person using the editor.

### Locate the repository root with `pnpm-workspace.yaml`

Tests walk up from their own folder to the nearest `pnpm-workspace.yaml` (`test/support/repo.ts`).

## Repo layout

| Path                         | What                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `packages/core/`             | Markdown ↔ document, source map, serializer, host interfaces. No DOM, no host.     |
| `packages/core/test/corpus/` | `realistic/` hand-written documents, `spec/` the 672 GFM spec examples.            |
| `packages/editor/`           | The ProseMirror view both hosts load; `harness/` is a browser host for Playwright. |
| `apps/desktop/`              | Electron app. `src/main` is the main process; `src/renderer` the page.             |
| `apps/vscode/`               | VS Code extension; `test/` runs inside VS Code via `@vscode/test-cli`.             |
| `scripts/`                   | `gate.mjs` (the release gate), `check-toolchain.mjs`.                              |
| `docs/spikes/`               | Spike reports.                                                                     |
