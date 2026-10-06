---
name: triage
description: Read the open GitHub issues that are ready to be implemented and report a build order — what to do next, which issues ship together as one release, the model and effort each is worth, and the few that are worth a code review. Reports only; files, labels and starts nothing. Use when the user invokes /triage, or says "what should I work on", "triage the issues", "what's next", "plan the next release".
---

# Triage

Run this in the desktop app. The report is tables, and a terminal does not render them.

## Turn the voice on first

Before the first `gh` call, run `/claude-voice Triage`. The report covers every issue, so the
phrase is the bare word.

When this session has already turned the voice on or off, leave the voice and its phrase as they
are. `/claude-voice off` stops it and the report carries on unchanged.

## The eligible set

One call, filtered locally:

```bash
gh issue list --repo dseelinger/wysidown --state open --limit 300 --json number,title,labels,author,createdAt
```

Keep an issue only if **all** of these hold:

- It does not carry `question`, `duplicate`, `invalid` or `wontfix`. None of them is implementable
  as written.
- Either `dseelinger` opened it, or it carries `Vetted`. Anything else is unvetted.

Say in one line how many survived and how many each rule removed. Then stop justifying: the point
of the report is the order, not the filter.

## What each issue needs first

A body may name its prerequisites: a `Needs first: #5, #6.` line, or a sentence `Needs #5 first`.
Title and labels do not show them, so read them in one more call:

```bash
gh issue list --repo dseelinger/wysidown --state open --limit 300 --json number,body --jq '.[] | {n: .number, needs: ([.body | scan("(?:^|[^`])Needs first:[^.\n]*"), scan("Needs #[0-9][^.\n]* first")] | map([scan("#[0-9]+") | ltrimstr("#")]) | add // [] | unique)} | select(.needs != []) | "\(.n): \(.needs | join(" "))"'
```

A needed issue is done when it is not in the open list, or when `git log main --format=%B` has the
line `Closes #N`. An eligible issue with a needed issue that is not done is **waiting**.

Where no body names a prerequisite, the layering still orders the work: core before the editor
that uses it, the editor before a host that loads it. An issue that cannot be built until another
issue's code exists ranks after it even when its body does not say so. Name each such inferred
dependency in **Not now** or in the issue's row title, so the maintainer can add the `Needs first:`
line.

## Read only what you need

Bodies here are short, a few lines each. Fetch them in one call, save them to the scratchpad, and
read them there. Read a linked doc or spike report only where the body leaves the scope unclear.

## Order

Development is sequential — one checkout, one session at a time, commits to `main` — so the order
is a queue. Rank by, in this order:

1. **Blocking.** A waiting issue ranks after every issue it needs, never before and never first.
   Where one of those is not in the queue — ineligible, or left out — the waiting issue is left out
   too and named in **Not now** with what it waits on.
2. **Fidelity.** An issue where wysidown changes bytes the user did not edit, loses content, or
   fails to save outranks everything else. Changing the user's file unasked is the worst thing it
   does.
3. **Foundation.** Work that later issues build on — the editor view before a feature rendered in
   it, a host before host-specific behaviour — ranks ahead of work nothing else waits on.
4. **Adjacency.** Issues touching the same package or the same node type go consecutive, so one
   session's context pays for several. `packages/core/src/markdown/` is one subsystem; each node
   type (tables, lists, links, code blocks) is usually another.
5. **Certainty.** A well-scoped issue before a vague one. Each is independently releasable, so
   certain work first is not a compromise.

An issue that names a whole area (`Tables`, `Paste handling`) rather than one change is still
ranked, but flag it in its row title as needing a split when its body lists more than one
subsystem (see `/issue-worker`'s **When it is bigger than it looked**).

## Release groups

The current version is the newest tag: `git tag --list 'v*' --sort=-v:refname | head -1`. With no
tag, the first release is `0.1.0`. `CHANGELOG.md` holds the unreleased entries under
`## Unreleased`; read it for what has landed since the tag, never for what the next number is.

Number a group from what it does. A corrected behaviour is a patch. A user-visible capability
added or removed is a minor. Before `1.0.0`, that is the whole rule.

A group is what ships under one version:

- **2 to 5 issues.** Fewer wastes a release; more delays every change in it behind the slowest.
- **They share a subject**, so they fold into one CHANGELOG heading. An issue moved up only because
  another needs it shares that issue's subject, and can go in its group.
- **They take the same increment.** A group holding both a fix and a new capability is numbered by
  the capability, which makes the fixes in it read as features. Split it instead. A single issue
  that adds a capability is worth its own minor.

Name each group with the version it would take and a working title in the CHANGELOG's form
(`0.1.0 — <title>`). Both are provisional, and the maintainer knows it: do not mark them as
guesses. The title carries the subject the group shares; if it cannot, the group is wrong.

## Model and effort

Emit the exact tokens: `opus` / `sonnet` / `haiku`, and `low` / `medium` / `high` / `xhigh` /
`max`.

| Model    | Effort   | When                                                                                                                                                                                                             |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `haiku`  | `medium` | A string, a label, a config value. Almost never.                                                                                                                                                                 |
| `sonnet` | `medium` | The default. The issue names the change and the change follows from it.                                                                                                                                          |
| `opus`   | `medium` | The change is a judgement: which package owns it, how a node is drawn, which of several sites changes.                                                                                                           |
| `opus`   | `high`   | The change touches `parse.ts`, `serialize.ts` or `verify.ts`, adds a node type to the schema, changes the host/editor message protocol, crosses the layering rule, or the issue names a symptom without a cause. |

Opus runs at `medium` unless the last row applies. Do not pair `sonnet` with `high`: work that
needs more than `sonnet medium` goes to `opus medium`.

`low` only for a change whose diff you could write from the title. `xhigh` or `max` where the issue
is a design question presented as a task — say it needs specifying instead of picking an effort.

Never go below `medium` on anything in `packages/` or `apps/`. Strict TypeScript, typescript-eslint
`strictTypeChecked` with `--max-warnings 0`, and tests that fail on a console warning mean a
careless change does not merely read badly, it fails the gate.

## Review, and its budget

**The default is no review.** Leave the cell blank rather than writing "none".

Recommend `/code-review` only when the change is likely to touch one of these:

- The serializer path — `parse.ts`, `serialize.ts`, `verify.ts`, the source map. A change there
  can rewrite unedited bytes in a document the corpus does not contain.
- The layering rule, or an interface core declares for the hosts. The layering test catches the
  import, not a bad seam.
- The host/editor message protocol. Both hosts and the harness implement it, and a mismatch shows
  only at run time.
- The exemption lists: `an-edit-changes-only-its-own-bytes.test.ts`'s wider-by-design edits and
  `spec-known-failures.txt`. Adding an entry is how a fidelity regression gets accepted.

Recommend `/security-review` only for a change to the Electron renderer's sandbox, preload bridge,
IPC handlers or CSP; the VS Code webview's CSP, `localResourceRoots` or message handling; code that
opens a URL or a file path taken from document content; a new network destination; or the
installer and update path. Not for anything else.

**The budget: at most one review recommendation per release group.** If more than a third of the
list is flagged, the bar was set too low — raise it and report again.

## Output

Markdown, and short. Three parts:

1. One line: how many eligible, and what the filter removed.
2. **Next up** — the queue and its release groups, as one table:

   | Release                     | #                                                    | Issue                                 | Model    | Effort   | Review         |
   | --------------------------- | ---------------------------------------------------- | ------------------------------------- | -------- | -------- | -------------- |
   | 0.1.0 — Edit in the browser | [4](https://github.com/dseelinger/wysidown/issues/4) | Editor view and browser harness       | `opus`   | `high`   | `/code-review` |
   |                             | [7](https://github.com/dseelinger/wysidown/issues/7) | Read-only chips for unrendered syntax | `sonnet` | `medium` |                |

   A group's issues are consecutive rows. The version and title go in the first of them; the
   Release cell is blank on the rest, and blank throughout for an issue in no group. There is no
   separate release section and no sentence explaining a group.

   **Every issue number is a link** — `[4](https://github.com/dseelinger/wysidown/issues/4)` in the
   `#` column, and `[#4](https://github.com/dseelinger/wysidown/issues/4)` wherever a number appears
   in prose, including **Not now**.

   Shorten titles to the claim. The full title is one click away.

3. **Not now** — one line naming anything eligible you deliberately left out, and why, including
   each waiting issue and the numbers it waits on. Omit the section when there is nothing.

No launch lines. The maintainer starts the next session with `/issue-worker <N>` on the row's model
and effort.

No preamble, no summary of what triage is, no restating the rules above.

## Save the grid

After the report, write the same rows to `.claude/triage-state.json` with the Write tool.
`/issue-worker` reads it for the model, effort and review chosen here.

```json
{
  "generated": "2026-10-06T15:04:00Z",
  "eligible": 14,
  "issues": {
    "4": {
      "title": "Editor view and browser harness",
      "model": "opus",
      "effort": "high",
      "release": "0.1.0 - Edit in the browser",
      "review": "/code-review"
    }
  }
}
```

- `generated` is UTC. Get it from `date -u +%Y-%m-%dT%H:%M:%SZ`, never from memory.
- Every issue in the **Next up** table gets a row, whether or not it is in a release group.
- `model` and `effort` carry the exact tokens from the table.
- `release` and `review` are optional; leave them out where the table's cell is blank.
- Write the whole file each run. It is this triage's grid, not a record that accumulates.

Say it was written in one line at the end of the report, with the issue count. Nothing else.

## What this does not do

It files nothing, labels nothing, closes nothing and starts no work. Applying `Vetted`, splitting an
issue or adding a `Needs first:` line is the maintainer's, and a triage that edits the queue it just
read cannot be run twice.
