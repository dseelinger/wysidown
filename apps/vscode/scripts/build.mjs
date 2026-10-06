// Bundles the extension and its integration tests. Warnings fail the build.
import { build } from "esbuild";
import { readdirSync, rmSync } from "node:fs";

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

const results = [
  await build({ ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.cjs" }),
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
