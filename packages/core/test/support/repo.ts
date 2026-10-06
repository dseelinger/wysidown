import { existsSync, readdirSync } from "node:fs";
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

/** Every file under `dir` whose name matches `pattern`, as absolute paths. */
export function filesUnder(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && pattern.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}
