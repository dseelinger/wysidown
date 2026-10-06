# Inline links

See [the docs](https://example.com/docs) for setup, or the [FAQ](https://example.com/faq "Frequently asked").
A title in single quotes: [style guide](./STYLE.md 'House style'), and in parentheses:
[changelog](CHANGELOG.md (Changes)).

Destinations in angle brackets may hold spaces: [notes](<docs/meeting notes.md>).
Parentheses balance: [Markdown](https://en.wikipedia.org/wiki/Markdown_(markup_language)).
An empty destination: [nowhere]().

Formatting inside a link: [**bold** and *em*](https://example.com/format), and around one:
*see [the guide](https://example.com/guide)*, __[strong link](https://example.com/strong)__.
Code in a link: [`parseMarkdown`](packages/core/src/markdown/parse.ts#L33).

An image as a link: [![build](https://example.com/badge.svg)](https://example.com/ci).

Escapes in the text: [a \[bracketed\] word](https://example.com/escape) and a link
split over lines: [one
two](https://example.com/split).

> Quoted [link in a quote](https://example.com/quote).

- Item with [a link](https://example.com/item)
- Item with [another](https://example.com/another "Title")

| Name | Link |
| ---- | ---- |
| Home | [home](https://example.com/) |
