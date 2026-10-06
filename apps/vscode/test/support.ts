import type { HostMessage } from "@wysidown/core";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as vscode from "vscode";
import { EditorConnection } from "../src/editor-connection.ts";

/** The repository root: the nearest ancestor holding pnpm-workspace.yaml. */
function repoRoot(): string {
  let dir = __dirname;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found above " + __dirname);
    dir = parent;
  }
  return dir;
}

/** A realistic corpus fixture's text. */
export function fixture(name: string): string {
  return readFileSync(join(repoRoot(), "packages", "core", "test", "corpus", "realistic", name), "utf8");
}

/** Writes `bytes` to a file named `name` in a new temporary folder and returns its URI. */
export function tempFile(name: string, bytes: string | Uint8Array): vscode.Uri {
  const path = join(mkdtempSync(join(tmpdir(), "wysidown-")), name);
  writeFileSync(path, bytes);
  return vscode.Uri.file(path);
}

/** A connection to `document` that records every message it sends. */
export function connect(document: vscode.TextDocument): { connection: EditorConnection; sent: HostMessage[] } {
  const sent: HostMessage[] = [];
  const connection = new EditorConnection(document, (message) => sent.push(message));
  return { connection, sent };
}

/** Resolves once `check` returns true, polling; rejects after `ms` milliseconds. */
export async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
