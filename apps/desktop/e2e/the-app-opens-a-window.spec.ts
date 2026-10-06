import { _electron as electron, expect, test } from "@playwright/test";
import { join } from "node:path";

test("the app opens one window titled Wysidown with no console errors", async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, "..", "dist", "main.cjs")] });
  try {
    const window = await app.firstWindow();
    const errors: string[] = [];
    window.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
    });
    window.on("pageerror", (e) => errors.push(e.message));
    await window.waitForLoadState("domcontentloaded");
    expect(await window.title()).toBe("Wysidown");
    expect(app.windows()).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
