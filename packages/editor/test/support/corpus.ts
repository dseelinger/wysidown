import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The repository root: the nearest ancestor holding pnpm-workspace.yaml. */
export function repoRoot(): string {
  let dir = import.meta.dirname;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found above " + import.meta.dirname);
    dir = parent;
  }
  return dir;
}

/** The realistic corpus with LF, CRLF and a byte order mark, named for test titles. */
export function realisticCases(): { name: string; text: string }[] {
  const dir = join(repoRoot(), "packages", "core", "test", "corpus", "realistic");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .flatMap((f) => {
      const text = readFileSync(join(dir, f), "utf8");
      return [
        { name: `${f} (lf)`, text },
        { name: `${f} (crlf)`, text: text.replace(/\n/g, "\r\n") },
        { name: `${f} (bom)`, text: "﻿" + text },
      ];
    });
}

/** A realistic corpus document's text, as stored. */
export function fixture(name: string): string {
  return readFileSync(join(repoRoot(), "packages", "core", "test", "corpus", "realistic", name), "utf8");
}
