import type { Page } from "@playwright/test";
import { caret, expect, fixture, hostText, load, settled, test } from "./support.ts";

/** Pastes clipboard `data`, keyed by type, at the caret. */
async function paste(page: Page, data: Record<string, string>): Promise<void> {
  await page.evaluate((items) => {
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(items)) transfer.setData(type, value);
    const target = document.activeElement ?? document.querySelector(".ProseMirror")!;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, data);
  await settled(page);
}

/** Loads a short document, pastes `data` at the end of its first paragraph, and returns the host's text. */
async function pasteAfterIntro(page: Page, data: Record<string, string>): Promise<string> {
  await load(page, "# Notes\n\nIntro.\n\nLast.\n");
  await caret(page, "Intro.", "End");
  await paste(page, data);
  return hostText(page);
}

test("HTML from a web page becomes headings, lists, links, code and tables", async ({ harness: page }) => {
  const html = [
    "<h2>Setup</h2>",
    '<p>Read <a href="https://example.com/docs" title="Docs">the <b>docs</b></a> and <em>then</em> run <code>npm i</code>.</p>',
    "<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>",
    '<ol start="3"><li>three</li></ol>',
    '<ul><li class="task-list-item"><input type="checkbox" checked disabled> done</li></ul>',
    '<div class="highlight highlight-source-js"><pre>const a = 1;\nconst b = 2;\n</pre></div>',
    '<table><thead><tr><th>Name</th><th align="right">Size</th></tr></thead><tbody><tr><td><p>a | b</p></td><td>1</td></tr></tbody></table>',
    '<p><img src="https://example.com/x.png" alt="An image"><img src="data:image/png;base64,AAAA" alt="inline"></p>',
    '<p><a href="javascript:alert(1)">unsafe</a></p>',
  ].join("");
  const text = await pasteAfterIntro(page, { "text/html": html, "text/plain": "ignored" });
  expect(text).toBe(
    [
      "# Notes\n\nIntro.\n\n## Setup\n\nRead [the **docs**](https://example.com/docs) and *then* run `npm i`.\n\n",
      "- one\n- two\n  - nested\n\n3. three\n\n- [x] done\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\n",
      "| Name   | Size |\n| ------ | ---: |\n| a \\| b |    1 |\n\n![An image](https://example.com/x.png)\n\nunsafe\n\nLast.\n",
    ].join(""),
  );
});

test("HTML from Word becomes paragraphs and nested lists without Word's markup", async ({ harness: page }) => {
  const html = [
    "<html xmlns:o='urn:schemas-microsoft-com:office:office'><head><style>p.MsoNormal{margin:0}</style></head><body>",
    "<!--StartFragment-->",
    "<p class=MsoNormal><b>Agenda</b> for&nbsp;today<o:p></o:p></p>",
    "<p class=MsoNormal><o:p>&nbsp;</o:p></p>",
    "<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt \"Times New Roman\"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Budget<o:p></o:p></p>",
    "<p class=MsoListParagraphCxSpMiddle style='margin-left:1.0in;text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span><span style='mso-list:Ignore'>1.<span>&nbsp;&nbsp; </span></span></span><![endif]>Travel<o:p></o:p></p>",
    "<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span><span style='mso-list:Ignore'>·<span>&nbsp; </span></span></span><![endif]><i>Hiring</i><o:p></o:p></p>",
    "<p class=MsoNormal>Close.<o:p></o:p></p>",
    "<!--EndFragment--></body></html>",
  ].join("\r\n");
  const text = await pasteAfterIntro(page, { "text/html": html, "text/plain": "ignored" });
  expect(text).toBe("# Notes\n\nIntro.**Agenda** for today\n\n- Budget\n  1. Travel\n- *Hiring*\n\nClose.\n\nLast.\n");
});

test("HTML from Google Docs keeps its bold and italic spans and drops the wrapper's", async ({ harness: page }) => {
  const html =
    '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:400;">Plain, </span><span style="font-weight:700;">bold</span><span style="font-weight:400;"> and </span><span style="font-style:italic;font-weight:400;">italic</span><span style="font-weight:400;">, </span><span style="text-decoration:line-through;font-weight:400;">gone</span></p><p dir="ltr"><span style="font-weight:400;">Second.</span></p></b>';
  const text = await pasteAfterIntro(page, { "text/html": html, "text/plain": "ignored" });
  expect(text).toBe("# Notes\n\nIntro.Plain, **bold** and *italic*, ~~gone~~\n\nSecond.\n\nLast.\n");
});

test("code copied from VS Code becomes a code block in its language", async ({ harness: page }) => {
  const code = "function add(a: number, b: number) {\r\n  return a + b;\r\n}";
  const html =
    '<div style="color: #cccccc;background-color: #1f1f1f;font-family: Consolas, monospace;white-space: pre;"><div><span>function add</span></div><div><span>  return a + b;</span></div><div><span>}</span></div></div>';
  const text = await pasteAfterIntro(page, {
    "text/plain": code,
    "text/html": html,
    "vscode-editor-data": JSON.stringify({ version: 1, isFromEmptySelection: false, mode: "typescript" }),
  });
  expect(text).toBe(
    "# Notes\n\nIntro.\n\n```typescript\nfunction add(a: number, b: number) {\n  return a + b;\n}\n```\n\nLast.\n",
  );
});

test("markdown copied from VS Code is read as markdown", async ({ harness: page }) => {
  const text = await pasteAfterIntro(page, {
    "text/plain": "\r\n\r\n## Added\r\n\r\n- *one*\r\n- two\r\n",
    "text/html": '<div style="white-space: pre;"><div><span>## Added</span></div><div><span>- one</span></div></div>',
    "vscode-editor-data": JSON.stringify({ version: 1, mode: "markdown" }),
  });
  expect(text).toBe("# Notes\n\nIntro.\n\n## Added\n\n- *one*\n- two\n\nLast.\n");
});

test("VS Code's coloured HTML alone becomes a code block", async ({ harness: page }) => {
  const html =
    '<div style="font-family: Consolas;white-space: pre;"><div><span>let a = 1;</span></div><div><br></div><div><span>let b = 2;</span></div></div>';
  const text = await pasteAfterIntro(page, { "text/html": html, "text/plain": "let a = 1;\n\nlet b = 2;" });
  expect(text).toBe("# Notes\n\nIntro.\n\n```\nlet a = 1;\n\nlet b = 2;\n```\n\nLast.\n");
});

test("plain text is read as markdown", async ({ harness: page }) => {
  const text = await pasteAfterIntro(page, { "text/plain": " See **this** and [that](./that.md)." });
  expect(text).toBe("# Notes\n\nIntro. See **this** and [that](./that.md).\n\nLast.\n");
});

test("Ctrl+Shift+V pastes text literally", async ({ harness: page }) => {
  await load(page, "# Notes\n\nIntro.\n\nLast.\n");
  await caret(page, "Intro.", "End");
  await page.keyboard.down("Shift");
  await paste(page, { "text/plain": " See **this**.", "text/html": "<p>See <b>this</b>.</p>" });
  await page.keyboard.up("Shift");
  expect(await hostText(page)).toBe("# Notes\n\nIntro. See \\*\\*this\\*\\*.\n\nLast.\n");
});

test("content copied in the editor pastes back as the same document", async ({ harness: page }) => {
  const links = fixture("35-inline-links.md");
  await load(page, links);
  const shown = () => page.evaluate(() => document.querySelector(".ProseMirror")!.innerHTML);
  const before = await shown();
  await page.locator(".ProseMirror").focus();
  await page.keyboard.press("Control+a");
  const copied = await page.evaluate(() => {
    const transfer = new DataTransfer();
    document.activeElement!.dispatchEvent(
      new ClipboardEvent("copy", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
    return { "text/html": transfer.getData("text/html"), "text/plain": transfer.getData("text/plain") };
  });
  await load(page, "Replace me.\n");
  await page.locator(".ProseMirror").focus();
  await page.keyboard.press("Control+a");
  await paste(page, copied);
  expect(await shown()).toBe(before);
  await load(page, await hostText(page));
  expect(await shown()).toBe(before);
});
