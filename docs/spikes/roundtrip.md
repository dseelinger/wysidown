# Round-trip fidelity spike

Question: which editor foundation lets wysidown save a document so that text the user did not
edit keeps its exact bytes? Candidates: Tiptap 3.31.4 (`@tiptap/markdown`), Milkdown 7.22.2
(commonmark and gfm presets), and ProseMirror 1.25 with mdast (`mdast-util-from-markdown` 2.1,
`micromark-extension-gfm` 3.0).

Recommendation: **ProseMirror + mdast, with a source-preserving serializer written in core.** Do
not use Tiptap or Milkdown.

Code: `spikes/roundtrip/` in commit `ebc1097` (removed afterwards; the corpus moved to
`packages/core/test/corpus/`). In that commit, re-run with
`npx tsx src/measure.ts mdast tiptap milkdown`, `npx tsx src/proto/run.ts` and `npx vitest run`.

## Corpus

- `corpus/realistic/`: 32 hand-written documents. They cover READMEs with badges, aligned and
  ragged tables, nested, loose and tight lists, task lists, fenced and indented code, reference
  links, autolinks, HTML blocks and inline HTML, front matter, footnotes, alerts, math, mermaid,
  hard breaks, escapes and entities, setext headings, every list and emphasis marker variant,
  tabs, Unicode and odd whitespace.
- `corpus/spec/`: the 672 examples of the GFM spec 0.29, one file each (CC-BY-SA 4.0).
- Each realistic file is also tested with CRLF line endings, with a UTF-8 BOM, and with no final
  newline. These variants are generated in the test.

## 1. Each library's own serializer

"Same HTML" means the output renders to the same HTML as the input under micromark with GFM. It
measures whether meaning survived, as opposed to bytes.

| Candidate                        | Set             | Files | Byte-identical | Same HTML | Errors logged |
| -------------------------------- | --------------- | ----: | -------------: | --------: | ------------: |
| mdast (`mdast-util-to-markdown`) | realistic, LF   |    32 |              3 |        30 |             0 |
|                                  | realistic, CRLF |    32 |              0 |        30 |             0 |
|                                  | spec            |   672 |            202 |       670 |             0 |
| Tiptap                           | realistic, LF   |    32 |              0 |        18 |             0 |
|                                  | realistic, CRLF |    32 |              0 |        18 |             0 |
|                                  | spec            |   672 |              1 |       464 |             0 |
| Milkdown                         | realistic, LF   |    32 |              3 |        27 |             1 |
|                                  | realistic, CRLF |    32 |              0 |        27 |             1 |
|                                  | spec            |   672 |            167 |       613 |            10 |

None of them is byte-identical on real documents. Every canonical serializer rewrites `*` and
`+` bullets as one marker, `_x_` as `*x*`, setext headings as ATX, `1.` `1.` `1.` as `1.` `2.` `3.`,
`1)` as `1.`, `---` rules as `***`, and re-pads every table. It also drops trailing hard-break
spaces in favour of `\`, removes unneeded escapes, decodes entities, and converts CRLF to LF.

**Tiptap loses content as well as formatting.** Raw HTML blocks are escaped into text
(`<details>` becomes `&lt;details&gt;`). Reference links are inlined and their definitions are
dropped. A reference-style image is reduced to its alt text. Footnotes are escaped into
`\[^1\]`, entities are double-escaped (`&amp;copy;`), and front matter becomes a heading. Its
parser is `marked`, whose tokens carry raw text but no source offsets.

**Milkdown also loses content, without raising an error.** In the badge README its image parser
throws on an image with no title. The three-badge paragraph is missing from the output, and the
only sign is a `console.error`. Its editor cannot be created without a DOM (`document.body`,
`addEventListener`), so parsing in Node needs happy-dom. Its parser is remark, so mdast offsets
exist, but its parser runners discard them.

**mdast alone keeps meaning in 30 of 32 files.** The two failures are math (`\,` loses its
backslash) and front matter (without the frontmatter extension it reads as a rule and a setext
heading). It runs in Node with no DOM, and every mdast node carries start and end offsets.

## 2. Source-preserving serializer prototype (ProseMirror + mdast)

`src/proto/` is about 830 lines. Parsing builds a ProseMirror document from mdast and keeps a
map from each ProseMirror node to its source range. For every textblock it also keeps a map
from each character to the source offsets it came from, which accounts for escapes, entities
and line prefixes. Syntax the schema does not model is kept as opaque `raw_block` and
`raw_inline` nodes holding their source: definitions, footnote definitions, front matter, math
and inline HTML.

Serialization relies on ProseMirror reusing unchanged node objects between document versions:

1. A node that is the same object as at load time is written as its original source slice.
2. A container whose children changed is rebuilt from its original gaps (blank lines, `> `
   prefixes, list markers) and its children, recursively. Unchanged children are copied;
   inserted children are re-serialized and indented with the container's continuation prefix.
3. In an edited textblock, a text-only edit inside one run of text is spliced into the original
   bytes at the mapped offsets, with markdown characters escaped.
4. If step 3 cannot express the edit, the block's inline content is re-serialized and its own
   syntax is kept from the source: the `## ` marker, cell pipes and padding.
5. If that fails, the block is re-serialized whole.
6. For an insertion or deletion that still fails, the edited region is re-serialized together
   with its immediate neighbours.

After every step the output is re-parsed and compared with the intended document. The first
step that verifies is used. Toggling a task checkbox rewrites only the `[ ]` or `[x]`.

### Results

Each edit kind is applied in turn to every eligible block of every file (one edit per run):

| Set                         | Identity | Replace a word | Type `a*b_[c]` + backtick + `d` | Bold a word | Insert paragraph | Delete block | Toggle task |
| --------------------------- | -------: | -------------: | ------------------------------: | ----------: | ---------------: | -----------: | ----------: |
| realistic, LF               |    32/32 |        315/316 |                         316/316 |     210/210 |          252/252 |      233/252 |       11/11 |
| realistic, CRLF             |    32/32 |        315/316 |                         316/316 |     210/210 |          252/252 |      233/252 |       11/11 |
| realistic, BOM              |    32/32 |        315/316 |                         316/316 |     210/210 |          252/252 |      233/252 |       11/11 |
| realistic, no final newline |    32/32 |        315/316 |                         316/316 |     210/210 |          252/252 |      233/252 |       11/11 |
| spec                        |  671/672 |        581/643 |                         641/643 |     584/586 |          906/919 |      359/434 |         6/6 |

Pass criteria:

- Identity: output equals input. Containers are walked rather than copied whole, so the gap
  logic is exercised.
- Replace a word: exactly the word's bytes change.
- The other edits: every byte outside the edited block is unchanged, and the output re-parses to
  the intended document.

Every realistic-corpus failure falls into one of two categories:

- **Wider than needed but correct (10).** Editing the text of the shortcut reference
  `[Unreleased]` turns it into `[EDITED][Unreleased]`, so the link still resolves. Deleting the
  paragraph or heading between two lists that use the same marker would merge them, so the
  neighbours are rewritten to keep them apart.
- **Markdown cannot express the edit (10).** Deleting a link or footnote definition changes
  every paragraph that refers to it. The editor has to decide what that means, for example by
  turning the references into plain text. No serializer can avoid it.

In the spec set, the failures are the same two categories plus 10 serializer faults. They come
from two pathological examples. In #184, mdast gives a definition and a setext heading
overlapping ranges. In #235, deleting the list leaves a line indented five spaces, which then
reads as code.

### Performance

Measured on the prototype with no optimisation:

| Document | Parse | Serialize + verify one edit |
| -------- | ----: | --------------------------: |
| 36 KB    | 88 ms |                       77 ms |
| 361 KB   | 1.1 s |                       1.1 s |

Verification re-parses the whole document, which is too slow to run on every keystroke above
about 30 KB. Core must verify only the changed top-level blocks, which is possible because those
blocks are known.

## 3. Comparison

| Criterion                             | Tiptap                                                        | Milkdown                                                                                       | ProseMirror + mdast                                          |
| ------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Byte fidelity reachable               | No source offsets in `marked` tokens; would need a new parser | Offsets exist in mdast but runners drop them; both transformer directions would need replacing | Demonstrated above                                           |
| Headless (Node, no DOM)               | Yes (`MarkdownManager`)                                       | No: the editor needs `document`                                                                | Yes                                                          |
| Content preserved by its own pipeline | No: HTML, references, footnotes, entities                     | No: drops an untitled image paragraph                                                          | Yes, with opaque nodes for the rest                          |
| GFM coverage                          | Tables, tasks, strike; no footnotes                           | Full GFM via remark                                                                            | Full GFM plus front matter and math via micromark extensions |
| What we would own                     | Parser and serializer, fighting its extension model           | Parser and serializer, inside its ctx/timer plugin system                                      | Schema, parser, serializer, commands, input rules, keymaps   |
| Licence                               | MIT core; Pro extensions paid                                 | MIT                                                                                            | MIT                                                          |

Fidelity requires owning both directions of the markdown transform. That removes most of what
Tiptap and Milkdown offer. What they would still add, UI plumbing and extension registration, is
smaller than what we would have to work around.

## Consequences for the plan

- **Stack:** `prosemirror-model`, `-state`, `-view`, `-transform`, `-commands`, `-keymap`,
  `-history`, `-inputrules`, and later `prosemirror-tables`. For markdown:
  `mdast-util-from-markdown`, `mdast-util-to-markdown` (used only as the fallback writer),
  `micromark-extension-gfm`, `-frontmatter` and `-math` with their `mdast-util-*` pairs. No
  Tiptap and no Milkdown.
- **Issue 3 (core)** takes the prototype's structure and rewrites it under the skeleton's rules:
  the source map, the fallback steps in order with verification after each, per-block
  verification, and opaque nodes.
- **Issue 7 (opaque nodes)** must also decide how deleting a definition affects its references.
- **Known edge cases to carry as tests:** overlapping mdast ranges (spec #184), GFM autolink
  literals (no positions, so not editable by splicing), an insert after an unclosed fence, and
  `$5 and $10` read as inline math by `micromark-extension-math`.
- **Corpus pass bar:** the realistic corpus passes every test in
  `src/proto/fidelity.test.ts` (897 tests). The spec set's known failures are listed per
  example, as the plan describes.
- **Toolchain:** the spike used npm. The skeleton pins TypeScript 6.0.3 rather than 7.0.2 (the
  native port), because typescript-eslint supports `<6.1` and the layering test uses the
  compiler API.
