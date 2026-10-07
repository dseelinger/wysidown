import { caret, fixture, save, test } from "./support.ts";

const nested = fixture("04-lists-nested.md");

test("undo after typing removes the last typed word, and undo again the word before it", async ({ open }) => {
  const o = await open("04-lists-nested.md");
  await caret(o, "Pears", "End");
  await o.window.keyboard.type(" and figs");
  // The editor sends typing once it pauses for a second.
  await o.window.waitForTimeout(2000);
  await o.window.keyboard.press("Control+Z");
  await save(o, nested.replace("  - Pears\n", "  - Pears and\n"));
  await o.window.keyboard.press("Control+Z");
  await save(o, nested);
});

test("undo straight after typing removes the last typed word and keeps the word before it", async ({ open }) => {
  const o = await open("04-lists-nested.md");
  await caret(o, "Pears", "End");
  await o.window.keyboard.type(" and figs");
  await o.window.keyboard.press("Control+Z");
  await save(o, nested.replace("  - Pears\n", "  - Pears and\n"));
});
