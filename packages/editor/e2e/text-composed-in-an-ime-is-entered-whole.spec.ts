import type { EditorMessage } from "@wysidown/core";
import type { CDPSession, Page } from "@playwright/test";
import { caret, caretAt, expect, hostText, load, settled, test } from "./support.ts";

const doc = `# A heading

A paragraph of text.

- A list item
- [ ] A task item

| Name | Value |
| ---- | ----- |
| cell | data |

\`\`\`js
let x = 1;
\`\`\`

See [the link](https://example.com) here.
`;

const japanese = ["に", "にほ", "にほん", "日本"];

/** Counts the composition events on the editor, from now on. */
async function countCompositions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const counts = { start: 0, end: 0 };
    Object.assign(window, { compositions: counts });
    const dom = document.querySelector(".ProseMirror")!;
    dom.addEventListener("compositionstart", () => counts.start++);
    dom.addEventListener("compositionend", () => counts.end++);
  });
}

/** The composition events counted since `countCompositions`. */
async function compositions(page: Page): Promise<{ start: number; end: number }> {
  return page.evaluate(() => (window as unknown as { compositions: { start: number; end: number } }).compositions);
}

/** Shows each of `steps` as the uncommitted text of a composition at the caret, as an IME does while the user types. */
async function compose(page: Page, cdp: CDPSession, steps: readonly string[]): Promise<void> {
  for (const text of steps) {
    await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    await page.waitForTimeout(30);
  }
}

/** Commits the open composition as `text`. */
async function commit(cdp: CDPSession, text: string): Promise<void> {
  await cdp.send("Input.insertText", { text });
}

/** The text each edit the editor has sent inserts, in order. */
async function insertedByEdits(page: Page): Promise<string[]> {
  const messages = await page.evaluate(() => window.harness.messages);
  return messages
    .filter((m): m is Extract<EditorMessage, { type: "edit" }> => m.type === "edit")
    .map((m) => m.edits.map((e) => e.insert).join(""));
}

const places: { name: string; at: (page: Page) => Promise<void>; steps: string[]; text: string; saved: string }[] = [
  {
    name: "a heading",
    at: (page) => caret(page, "A heading", "End"),
    steps: japanese,
    text: "日本",
    saved: doc.replace("# A heading", "# A heading日本"),
  },
  {
    name: "a paragraph",
    at: (page) => caret(page, "A paragraph of text.", "End"),
    steps: japanese,
    text: "日本",
    saved: doc.replace("of text.", "of text.日本"),
  },
  {
    name: "a list item",
    at: (page) => caret(page, "A list item", "End"),
    steps: ["ㅎ", "하", "한"],
    text: "한",
    saved: doc.replace("- A list item", "- A list item한"),
  },
  {
    name: "the start of a task list item",
    at: (page) => caretAt(page, "A task item", 0),
    steps: ["n", "ni", "你"],
    text: "你",
    saved: doc.replace("- [ ] A task item", "- [ ] 你A task item"),
  },
  {
    name: "a table cell",
    at: (page) => caretAt(page, "cell", "cell".length),
    steps: ["´", "é"],
    text: "é",
    saved: doc.replace("| cell |", "| cellé |"),
  },
  {
    name: "a code block, where the composed text changes the highlighting",
    at: (page) => caret(page, "let x = 1;", "End", "Enter"),
    steps: ["c", "co", "con", "const"],
    text: "const",
    saved: doc.replace("let x = 1;\n", "let x = 1;\nconst\n"),
  },
  {
    name: "a link's text",
    at: (page) => caretAt(page, "the link", "the".length),
    steps: japanese,
    text: "日本",
    saved: doc.replace("[the link]", "[the日本 link]"),
  },
  {
    name: "the end of a link's text, which it follows as typing does,",
    at: (page) => caretAt(page, "the link", "the link".length),
    steps: ["😀"],
    text: "😀",
    saved: doc.replace("(https://example.com)", "(https://example.com)😀"),
  },
];

for (const place of places) {
  test(`text composed in ${place.name} is entered once and saves as only its own bytes`, async ({ harness: page }) => {
    await load(page, doc);
    await place.at(page);
    await countCompositions(page);
    const cdp = await page.context().newCDPSession(page);
    await compose(page, cdp, place.steps);
    expect(await compositions(page)).toEqual({ start: 1, end: 0 });
    await commit(cdp, place.text);
    await expect.poll(() => hostText(page)).toBe(place.saved);
    expect(await compositions(page)).toEqual({ start: 1, end: 1 });
  });
}

test("markdown syntax in an open composition stays as typed, and a closing marker it commits formats", async ({
  harness: page,
}) => {
  await load(page, doc);
  await caret(page, "A paragraph of text.", "End");
  await page.keyboard.type(" `code");
  await countCompositions(page);
  const cdp = await page.context().newCDPSession(page);
  await compose(page, cdp, ["`"]);
  await page.waitForTimeout(100);
  await expect(page.locator(".ProseMirror p code")).toHaveCount(0);
  expect(await compositions(page)).toEqual({ start: 1, end: 0 });
  await commit(cdp, "`");
  await expect(page.locator(".ProseMirror p code")).toHaveText("code");
  await expect.poll(() => hostText(page)).toBe(doc.replace("of text.", "of text. `code`"));
  expect(await compositions(page)).toEqual({ start: 1, end: 1 });
});

test("composing the end of a keyword that is already typed does not end the composition", async ({ harness: page }) => {
  await load(page, doc);
  await caret(page, "let x = 1;", "End", "Enter");
  await page.keyboard.type("con");
  await countCompositions(page);
  const cdp = await page.context().newCDPSession(page);
  await compose(page, cdp, ["s", "st"]);
  expect(await compositions(page)).toEqual({ start: 1, end: 0 });
  await commit(cdp, "st");
  await expect.poll(() => hostText(page)).toBe(doc.replace("let x = 1;\n", "let x = 1;\nconst\n"));
  expect(await compositions(page)).toEqual({ start: 1, end: 1 });
  await expect(page.locator(".ProseMirror pre .hljs-keyword", { hasText: "const" })).toHaveCount(1);
});

test("a find match that takes in text before the composition does not end it", async ({ harness: page }) => {
  await load(page, doc);
  await caret(page, "A paragraph of text.", "End");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("text.日本");
  await caretAt(page, "A paragraph of text.", "A paragraph of text.".length);
  await countCompositions(page);
  const cdp = await page.context().newCDPSession(page);
  await compose(page, cdp, japanese);
  expect(await compositions(page)).toEqual({ start: 1, end: 0 });
  await commit(cdp, "日本");
  await expect.poll(() => hostText(page)).toBe(doc.replace("of text.", "of text.日本"));
  expect(await compositions(page)).toEqual({ start: 1, end: 1 });
  await expect(page.locator(".ProseMirror .ProseMirror-search-match")).toHaveText("text.日本");
});

test("a find highlight does not end a composition whose text matches the query", async ({ harness: page }) => {
  await load(page, doc);
  await caret(page, "A paragraph of text.", "End");
  await page.keyboard.press("Control+f");
  await page.keyboard.type("日本");
  await caretAt(page, "A paragraph of text.", "A paragraph of text.".length);
  await countCompositions(page);
  const cdp = await page.context().newCDPSession(page);
  await compose(page, cdp, japanese);
  expect(await compositions(page)).toEqual({ start: 1, end: 0 });
  await commit(cdp, "日本");
  await expect.poll(() => hostText(page)).toBe(doc.replace("of text.", "of text.日本"));
  expect(await compositions(page)).toEqual({ start: 1, end: 1 });
  await expect(page.locator(".ProseMirror .ProseMirror-search-match")).toHaveText("日本");
});

for (const undo of ["editor", "host"]) {
  test(`a change from the host during a composition is applied when it ends, when the ${undo} owns undo`, async ({
    harness: page,
  }) => {
    if (undo === "host") {
      await page.goto("/?undo=host");
      await page.waitForFunction(() => "harness" in window);
    }
    await load(page, doc);
    await caret(page, "A paragraph of text.", "End");
    await countCompositions(page);
    const cdp = await page.context().newCDPSession(page);
    await compose(page, cdp, japanese.slice(0, 2));
    const changed = doc.replace("# A heading", "# A changed heading");
    await page.evaluate((text) => {
      window.harness.change(text);
    }, changed);
    await settled(page);
    await expect(page.locator("h1")).toHaveText("A heading");
    await compose(page, cdp, japanese.slice(2));
    await commit(cdp, "日本");
    await expect(page.locator("h1")).toHaveText("A changed heading");
    await expect(page.locator("p", { hasText: "A paragraph" })).toHaveText("A paragraph of text.日本");
    expect(await compositions(page)).toEqual({ start: 1, end: 1 });
    expect(await page.evaluate(() => window.harness.flush())).toBe(changed.replace("of text.", "of text.日本"));
  });
}

test.describe("when the host owns undo", () => {
  test.beforeEach(async ({ harness: page }) => {
    await page.goto("/?undo=host");
    await page.waitForFunction(() => "harness" in window);
    await load(page, doc);
    await caret(page, "A paragraph of text.", "End");
  });

  test("nothing is sent during a composition, and the committed text goes with the typing around it as one edit", async ({
    harness: page,
  }) => {
    await page.keyboard.type("x");
    const cdp = await page.context().newCDPSession(page);
    await compose(page, cdp, japanese.slice(0, 2));
    await page.waitForTimeout(1500);
    await compose(page, cdp, japanese.slice(2));
    await page.waitForTimeout(1500);
    expect(await insertedByEdits(page)).toEqual([]);
    await commit(cdp, "日本");
    await page.keyboard.type("!");
    await expect.poll(() => hostText(page)).toBe(doc.replace("of text.", "of text.x日本!"));
    expect(await insertedByEdits(page)).toEqual(["x日本!"]);
  });

  test("a save during a composition waits for it to end and includes the committed text", async ({ harness: page }) => {
    const cdp = await page.context().newCDPSession(page);
    await compose(page, cdp, japanese.slice(0, 2));
    const saved = page.evaluate(() => window.harness.flush());
    await page.waitForTimeout(300);
    expect(await insertedByEdits(page)).toEqual([]);
    await compose(page, cdp, japanese.slice(2));
    await commit(cdp, "日本");
    expect(await saved).toBe(doc.replace("of text.", "of text.日本"));
  });
});
