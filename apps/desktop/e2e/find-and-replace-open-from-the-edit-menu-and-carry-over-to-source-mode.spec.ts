import { test, type Page } from "@playwright/test";
import { clickAtEnd, copyFixture, expect, fixture, launch, menu, quit, save } from "./support.ts";

const name = "27-blog-post.md";
const blog = fixture(name);
const sentence = "That makes review painful.";

function bar(window: Page) {
  return window.getByRole("dialog", { name: "Find and replace" });
}

test("Edit > Replace opens the bar, and Replace All saves only the matched bytes", async () => {
  const path = copyFixture(name);
  const { app, window, errors } = await launch(path);
  try {
    await clickAtEnd(window, sentence);
    await expect(bar(window)).toBeHidden();
    await menu(app, "replace");
    await expect(bar(window).getByRole("textbox", { name: "Find" })).toBeFocused();
    await window.keyboard.type("diff");
    await expect(bar(window)).toContainText("of 3");
    await bar(window).getByRole("textbox", { name: "Replace" }).fill("change");
    await bar(window).getByRole("button", { name: "Replace All" }).click();
    await save(
      app,
      path,
      blog
        .replace("the diff shows", "the change shows")
        .replace("one-word diff.", "one-word change.")
        .replace("best diff", "best change"),
    );
    await window.keyboard.press("Escape");
    await expect(bar(window)).toBeHidden();
    await expect(window.locator(".ProseMirror")).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});

test("Ctrl+F reaches the page, and the query carries over to source mode", async () => {
  const path = copyFixture(name);
  const { app, window, errors } = await launch(path);
  try {
    await clickAtEnd(window, sentence);
    await window.keyboard.press("Control+f");
    const find = bar(window).getByRole("textbox", { name: "Find" });
    await expect(find).toBeFocused();
    await window.keyboard.type("diff");
    await expect(bar(window)).toContainText("of 3");
    await menu(app, "source-mode");
    await expect(window.locator(".cm-content")).toBeFocused();
    await expect(find).toHaveValue("diff");
    await expect(bar(window)).toContainText("of 6");
    await expect(window.locator(".cm-searchMatch")).toHaveCount(6);
    await window.keyboard.press("Control+h");
    await bar(window).getByRole("textbox", { name: "Replace" }).fill("change");
    await window.keyboard.press("Control+Alt+Enter");
    await save(app, path, blog.replaceAll("diff", "change"));
    expect(errors).toEqual([]);
  } finally {
    await quit(app);
  }
});
