// Bundles the Electron main process and copies the renderer page into dist/. Warnings fail the build.
import { build } from "esbuild";
import { cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

const result = await build({
  entryPoints: ["src/main/main.ts"],
  outfile: "dist/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "silent",
});
if (result.warnings.length > 0) {
  throw new Error(result.warnings.map((w) => w.text).join("\n"));
}

cpSync("src/renderer", "dist/renderer", { recursive: true });
