import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { hostImports } from "./support/host-imports.ts";
import { filesUnder, repoRoot } from "./support/repo.ts";

// core and editor run in Node with no host (the headless corpus tests) and inside both hosts'
// webviews; only apps/desktop and apps/vscode may reach electron, vscode or Node built-ins.
const root = repoRoot();
const hostFree = ["packages/core", "packages/editor"];

describe("the core and editor import no host", () => {
  test.each(hostFree)("no source file in %s refers to a host module", (pkg) => {
    const offenders = filesUnder(join(root, pkg, "src"), /\.(ts|tsx|mts|cts|js|mjs)$/).flatMap((file) =>
      hostImports(file, readFileSync(file, "utf8")).map((m) => `${relative(root, file)}: ${m}`),
    );
    expect(offenders).toEqual([]);
  });

  test.each(hostFree)("%s declares no host dependency in package.json", (pkg) => {
    const manifest = JSON.parse(readFileSync(join(root, pkg, "package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    const declared = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((k) =>
      Object.keys(manifest[k] ?? {}),
    );
    expect(declared.filter((d) => ["electron", "vscode", "@types/vscode", "@types/node"].includes(d))).toEqual([]);
  });

  test("the scanner reports every way a source file can refer to a host module", () => {
    const text = [
      '/// <reference types="node" />',
      'import { readFile } from "node:fs";',
      'import type { Uri } from "vscode";',
      'import "electron/main";',
      'export { join } from "path";',
      'import fsp = require("fs/promises");',
      'type Ipc = import("electron").IpcRenderer;',
      'const os = await import("node:os");',
      'const cp = require("child_process");',
      'import { thing } from "./local.ts";',
      'import { Schema } from "prosemirror-model";',
    ].join("\n");
    expect(hostImports("sample.ts", text)).toEqual([
      "node",
      "node:fs",
      "vscode",
      "electron/main",
      "path",
      "fs/promises",
      "electron",
      "node:os",
      "child_process",
    ]);
  });
});
