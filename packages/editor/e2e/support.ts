import { test as base, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {} from "../harness/api.ts";

/** A test on the harness page that fails on any console error, warning or page error. */
export const test = base.extend<{ harness: Page }>({
  harness: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.waitForFunction(() => "harness" in window);
    await use(page);
    expect(errors).toEqual([]);
  },
});

export { expect };

/** A realistic corpus fixture's text. */
export function fixture(name: string): string {
  let dir = import.meta.dirname;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    if (dirname(dir) === dir) throw new Error("pnpm-workspace.yaml not found above " + import.meta.dirname);
    dir = dirname(dir);
  }
  return readFileSync(join(dir, "packages", "core", "test", "corpus", "realistic", name), "utf8");
}

/** Loads `text` into the editor through the host and waits until it is shown. */
export async function load(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    window.harness.load(t);
  }, text);
  await settled(page);
}

/** Waits until no message is on its way between the editor and the host. */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() => window.harness.settled());
}

/** The host's text. */
export async function hostText(page: Page): Promise<string> {
  return page.evaluate(() => window.harness.text());
}

/** Clicks the text `text`, then presses each of `keys`, waiting each time until the editor has read the caret. */
export async function caret(page: Page, text: string, ...keys: string[]): Promise<void> {
  await page.getByText(text).click();
  await inSync(page);
  for (const key of keys) {
    await page.keyboard.press(key);
    await inSync(page);
  }
}

/** Waits until the editor has read the browser selection, which reaches it a moment after a click or key. */
export async function inSync(page: Page): Promise<void> {
  await page.waitForFunction(() => window.harness.selectionInSync());
}

/**
 * Places the caret `offset` characters after the start of `text` in the editor's DOM, or selects
 * the `length` characters from there. ProseMirror puts its own selection back over one set in
 * the first few milliseconds after it focuses or updates, so this waits that out first and
 * resolves once the editor has the selection.
 */
export async function caretAt(page: Page, text: string, offset: number, length = 0): Promise<void> {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".ProseMirror")!.focus();
  });
  await page.waitForTimeout(100);
  await page.evaluate(
    ([t, o, l]) => {
      const root = document.querySelector(".ProseMirror")!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const i = node.textContent!.indexOf(t);
        if (i < 0) continue;
        getSelection()!.setBaseAndExtent(node, i + o, node, i + o + l);
        return;
      }
      throw new Error(`"${t}" is not in one text node`);
    },
    [text, offset, length] as const,
  );
  await inSync(page);
  await page.waitForTimeout(100);
  await inSync(page);
}
