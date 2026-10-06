---
layout: post
title: Why round-trip fidelity matters
---

Most WYSIWYG Markdown editors rewrite the whole file on save. Open a document,
fix a typo, and the diff shows *every* list marker changed from `*` to `-`,
every table re-padded, and every `__strong__` turned into `**strong**`.

That makes review painful. A one-word change should be a one-word diff.

![A diff with hundreds of changed lines](./images/noisy-diff.png "Noisy diff")

## What "fidelity" means

1. Text you did not touch is saved byte for byte.
2. Text you did touch is saved in the style of the rest of the document.
3. Nothing the editor does not understand is lost.

> "The best diff is the one you expected."
> — a reviewer, probably

Thanks for reading. Comments go to [the discussion](https://example.com/d/1).
