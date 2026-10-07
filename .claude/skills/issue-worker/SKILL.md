---
name: issue-worker
description: Take one GitHub issue and land it — read it, build it, keep the checks clean, add the changelog entry when the change is user-visible, and commit in the repository's form. Does not push — the maintainer pushes once any review has run. Use when the user invokes /issue-worker, or says "you are the issue worker", "fix issue N", "take #N", "implement this issue".
---

# Issue worker

You take one issue and land it. Triage decided it was next; your job is the change itself.

`/issue-worker 4` has named the issue. Start on #4 in that same turn — do not acknowledge it and
wait for a second instruction saying the same thing.

Only a bare `/issue-worker`, carrying no issue, waits: acknowledge in one line, stop, and start when
the maintainer names one.

## Turn the voice on first

Once the issue is named, the first step of the working turn is
`/claude-voice Issue worker <number>`, the number spoken as words — `/claude-voice Issue worker
twelve` for #12. `/claude-voice off` stops it and the work carries on unchanged.

## One issue, one checkout

There is one checkout and work runs sequentially — no worktrees, no branches, no parallel issues.
Commits go to `main`. `main` is fixed forward: a mistake is a follow-up commit rather than a revert.

Before touching anything, check the tree is clean:

```bash
git status --porcelain --untracked-files=no
```

If it lists anything, stop and name the files. They are someone's unfinished work, and this commit
must not carry them.

Read the issue in full before touching anything:

```bash
gh issue view <N> --repo dseelinger/wysidown --json title,body,labels,comments
```

Bodies here are a few lines naming an area. Read the code they point at, `docs/spikes/roundtrip.md`
where the issue touches the serializer, and CLAUDE.md's rules, before deciding what the change is.

## Check what it needs first

List the issues this one names as prerequisites: a `Needs first: #5, #6.` line, or a sentence
`Needs #5 first`.

```bash
gh issue view <N> --repo dseelinger/wysidown --json body --jq '[.body | scan("(?:^|[^`])Needs first:[^.\n]*"), scan("Needs #[0-9][^.\n]* first")] | map([scan("#[0-9]+") | ltrimstr("#")]) | add // [] | unique | join(" ")'
```

A needed issue is done when it is closed on GitHub, or when a commit on local `main` carries the
line `Closes #N` — work committed but not yet pushed is not closed on GitHub:

```bash
for n in <needed numbers>; do
  s=$(gh issue view "$n" --repo dseelinger/wysidown --json state -q .state)
  if [ "$s" != CLOSED ] && ! git log main --format=%B | grep -qx "Closes #$n"; then echo "#$n is not done"; fi
done
```

Also check the code the issue builds on exists. An editor feature needs the editor view (#4); a
host feature needs that host (#5, #6). If it does not, stop with the tree unchanged, name what is
missing, and ask whether to take that issue instead. A direct instruction from the maintainer to go
ahead anyway overrides the check.

## What triage chose

`.claude/triage-state.json` holds the last triage's grid, keyed by issue number. Read the entry
for this issue when the file is there; it is a snapshot of a queue that moves, so treat a missing
entry as no information.

**A session cannot change its own model or effort.** Where the entry names a model or effort other
than the one you are running on, say so in one line and carry on; switching is the maintainer's,
from the model picker.

`review` is how triage's recommendation reaches you.

## The checks

The working loop is the filtered unit tests:

```bash
pnpm test:fast -t "<area>"
pnpm vitest run --project core
```

Before committing, run the checks the diff can break. Run each as its own command and read its
output; a check that fails is fixed, not skipped.

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

When the diff touches anything outside `packages/core`, also build and run the end-to-end tests of
every package that loads it. The editor bundle is loaded by the harness and both hosts, so a change
in `packages/editor` runs all three:

```bash
pnpm build
pnpm --filter @wysidown/editor e2e
pnpm --filter @wysidown/desktop e2e
pnpm --filter wysidown e2e
```

A change to `apps/desktop` alone runs only the desktop's, and `apps/vscode` alone only the
extension's.

When the change alters what a user sees or can do — the changes that get a changelog entry — run
`pnpm gate` instead of the build and end-to-end commands above. It runs them and every other
check, so the end-to-end suites still run once. A test-only or tooling change does not run the
gate.

Warnings are errors throughout: Vite and esbuild fail on a build warning, Vitest fails a test that
writes `console.warn` or `console.error`, Playwright fails on any console message of either kind.
There is no `eslint-disable`, `@ts-ignore` or `@ts-expect-error` in the tree; adding the first one
needs the maintainer's agreement, not a workaround reached for at the end.

## The rules that bite an implementer

CLAUDE.md has the full set. These are the ones a change trips over:

- **Fidelity.** Unedited bytes never change. A new node type records its source range, and its
  edits go through the serializer's steps like every other node. Add realistic fixtures for the
  syntax the issue covers to `packages/core/test/corpus/realistic/` and edits for them to the
  edit tests. Adding an entry to `an-edit-changes-only-its-own-bytes.test.ts`'s wider-by-design
  list or to `spec-known-failures.txt` accepts a regression; do it only when the wider rewrite is
  unavoidable, and say so in the commit body.
- **Corpus bytes.** Fixtures are compared byte for byte and stored with no line-ending conversion.
  Write them with the Write tool or a script that writes `\n`; check with
  `git diff --stat` that a new fixture is not shown as CRLF.
- **Layering.** Core has no DOM and no host; the editor imports no host. If the change seems to
  need either, it is a design question — stop and say so.
- **Hosts own the file.** The editor sends edits and receives changes through the message protocol
  core declares. A host change that needs the editor to know about files, paths or disks is the
  wrong seam.
- **Pinned versions.** Every dependency is pinned exactly, and pnpm refuses recently published
  versions. A new dependency gets an exact version old enough to install; a package with a build
  script also needs an `allowBuilds` entry in `pnpm-workspace.yaml`. Never add a release-age
  exemption.
- **Find the repository root with `pnpm-workspace.yaml`** (`test/support/repo.ts`).

## House style

Comments are terse: what the code does, and any constraint a caller must respect. No decision
logs, no historical commentary. If a constraint needs a paragraph, write a test that fails when it
is broken instead.

Tests and test files are named as behavioural sentences — `an unedited document saves to the same
bytes`, `the-core-and-editor-import-no-host.test.ts`.

Prose is plain: say what you mean, no metaphor standing in for a literal statement. This applies to
comments, the changelog entry and the commit message.

## The changelog

A change that alters what a user sees or can do gets one `CHANGELOG.md` entry under
`## Unreleased`, **in the same commit**, written for the person using the editor rather than for a
developer. A test-only or tooling change gets none.

## Commit

The subject names the area and the change, in the form `main` already uses:

```
Core: parse and save markdown keeping unedited bytes
```

The body says what changed and what the tests now show, in the same plain style. End it with a
`Closes` trailer naming the issue, then the `Co-Authored-By` trailer:

```
Closes #4

Co-Authored-By: ...
```

`Closes #4` is the line GitHub acts on when the maintainer pushes to `main`. Put it on the commit
that finishes the issue, and on that one only; earlier commits for the same issue carry none.

Never run `pnpm release`: releases are made only when the maintainer asks for one.

Do not push, and do not open a PR. The commit stays local so a review has something to read and its
findings can be amended into it.

## Reviews

Do not run `/code-review` by default. Run it when the triage state flags this issue for one, or
when the change ended up touching the serializer path (`parse.ts`, `serialize.ts`, `verify.ts`),
an exemption list, the host/editor message protocol, or an interface core declares for the hosts.
Run `/security-review` when it touched the Electron preload, IPC, sandbox or CSP, the VS Code
webview's CSP or message handling, or code that opens a URL or path taken from a document.
Otherwise the checks are the check.

Act on a review's findings only where you would block the commit for them, and for each one state
the file, the line, why it is wrong, and how to show it fails. Drop the rest.

## When it is bigger than it looked

Many issues here name an area, not a change. Stop and say so rather than pushing on when the work
turns out to need something from this list that the issue did not name:

- a second package beyond the one the issue is about (core and the editor together count as one
  when the issue is a node type)
- a change to the host/editor message protocol
- a new interface core declares for the hosts
- an entry in either exemption list
- a new dependency

Name what the issue actually is: two or more issues, each with what it covers and what it needs
first; a design question; or the same issue at a higher effort. An issue that grew one of these is
not the issue that was ranked.

## Saying how to test it

Say first whether it needs manual testing at all. If it does not, say so and name the tests that
cover it. If it does, give the steps as a numbered list and nothing else — one action per step,
each saying what to do and what to look for.

Steps are for what the suite cannot reach — typing feel, IME, a native dialog, VS Code's own undo
and save. Where the automated tests cover the change, say they cover it and name them.

### When it needs manual testing, launch it

Build first, then start what the steps use, in the background so the session keeps going:

```bash
pnpm build
pnpm --filter @wysidown/desktop exec electron .
```

For the extension, start the installed VS Code with the extension loaded from the build:

```bash
code --extensionDevelopmentPath="$(pwd)/apps/vscode" packages/core/test/corpus/realistic
```

The steps start from the running app. Say in one line above the list which app is running and that
it holds this commit.

### Capture it yourself where a picture can check it

Captures are shown to the maintainer, and only the desktop app displays them. If the system prompt
does not say this session runs in the Claude desktop app, stop, tell the maintainer the change
needs screenshots, and ask them to continue in the desktop app.

Where a result can be read off a picture — a rendered table, a chip, a theme colour, a layout —
take the screenshot yourself rather than handing over a step to judge by eye. In the harness, add
or reuse a Playwright spec under `packages/editor/e2e/` that loads the document and calls
`page.screenshot({ path })` into `test-results/`, run it, and read the PNG. Capture before and
after where the change is a look.

Send every capture you checked to the maintainer with `SendUserFile` (`display: "render"`), with a
caption naming the screen and what it shows. A capture you did not check is not sent.

### Every step is exact

Read the code the change touched before writing the steps, and take the names from it. Each step
names:

- **Where**: the window, the file to open (a path in `packages/core/test/corpus/realistic/` where
  one fits), and the place in the document.
- **What to do**: the keys, the menu item or command by its visible label, the exact text to type
  in quotes.
- **What to expect**: what the editor shows, and what the saved file contains — check it with
  `git diff` on the fixture or a copy of it, since fidelity is the point. Where the change is a
  fix, also say what the defect looked like.

Where a step changes a corpus file, add a final step that restores it (`git checkout -- <path>`).

Not acceptable: "check that it works", "verify it looks right", "try a few edits", "confirm
nothing regressed".

## Finishing

The turn where the work lands ends in this order:

1. Commit.
2. `/code-review` or `/security-review`, when **Reviews** calls for one, with its findings amended
   into the commit.
3. `pnpm local`, when the change alters what a user sees or can do, after `pnpm gate` passed. It
   installs the extension into the maintainer's VS Code, which CLAUDE.md allows. If it stops
   because `Wysidown.exe` is running or `code` is not on PATH, do not close the app or change
   PATH; say so in the report.
4. Launch the app, when the change needs manual testing.
5. The spoken done sentence, through `/claude-voice`'s command, unless the voice was turned off. It
   is the last tool call of the turn; a sentence left until after the report is not spoken.
6. The written report, then how to test it, and the exe path and extension version `pnpm local`
   printed.

This applies equally when the work lands on a turn started by a background agent's completion
notice rather than by the maintainer.
