// Packages release/wysidown.vsix from the bundled dist/. The repository LICENSE is copied in first.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";

copyFileSync("../../LICENSE", "LICENSE");
mkdirSync("release", { recursive: true });
execSync("pnpm exec vsce package --no-dependencies --out release/wysidown.vsix", { stdio: "inherit" });
