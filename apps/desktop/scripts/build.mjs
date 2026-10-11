// Bundles the Electron main process, the preload scripts, the document page and the tab row into dist/. Warnings fail the build.
import { build } from "esbuild";
import { copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

rmSync("dist", { recursive: true, force: true });

const editorSrc = dirname(fileURLToPath(import.meta.resolve("@wysidown/editor")));

const common = { bundle: true, sourcemap: true, logLevel: "silent" };
const results = await Promise.all([
  build({
    ...common,
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main.cjs",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["src/renderer/preload.ts"],
    outfile: "dist/preload.cjs",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["src/renderer/tab-row-preload.ts"],
    outfile: "dist/tab-row-preload.cjs",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: {
      "tab-row": "src/renderer/tab-row.ts",
      renderer: "src/renderer/renderer.ts",
      editor: join(editorSrc, "editor.css"),
    },
    outdir: "dist/renderer",
    platform: "browser",
    format: "iife",
    target: "chrome140",
  }),
]);
const warnings = results.flatMap((r) => r.warnings);
if (warnings.length > 0) {
  throw new Error(warnings.map((w) => w.text).join("\n"));
}

for (const file of ["index.html", "tab-row.html", "tab-row.css"]) {
  copyFileSync(join("src/renderer", file), join("dist/renderer", file));
}
