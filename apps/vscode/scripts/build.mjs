// Bundles the extension, its webview page and its integration tests. Warnings fail the build.
import { build } from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

rmSync("dist", { recursive: true, force: true });
rmSync("dist-test", { recursive: true, force: true });

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "silent",
};

const editorSrc = dirname(fileURLToPath(import.meta.resolve("@wysidown/editor")));

const results = [
  await build({ ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.cjs" }),
  await build({
    bundle: true,
    sourcemap: true,
    logLevel: "silent",
    entryPoints: { webview: "src/webview/webview.ts", editor: join(editorSrc, "editor.css") },
    outdir: "dist/webview",
    platform: "browser",
    format: "iife",
    target: "chrome140",
  }),
  await build({
    ...common,
    entryPoints: readdirSync("test")
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => `test/${f}`),
    outdir: "dist-test",
    outExtension: { ".js": ".cjs" },
  }),
];
const warnings = results.flatMap((r) => r.warnings);
if (warnings.length > 0) {
  throw new Error(warnings.map((w) => w.text).join("\n"));
}
