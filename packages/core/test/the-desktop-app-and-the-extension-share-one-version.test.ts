import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { repoRoot } from "./support/repo.ts";

function version(app: string): string {
  const manifest = JSON.parse(readFileSync(join(repoRoot(), "apps", app, "package.json"), "utf8")) as {
    version: string;
  };
  return manifest.version;
}

test("the desktop app and the extension have the same version", () => {
  expect(version("desktop")).toBe(version("vscode"));
});
