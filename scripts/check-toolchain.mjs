// Fails unless the running Node and pnpm are exactly the pinned versions.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const wantNode = readFileSync(new URL(".node-version", root), "utf8").trim();
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const wantPnpm = manifest.packageManager.replace(/^pnpm@/, "");

const haveNode = process.version.replace(/^v/, "");
const havePnpm = execSync("pnpm --version", { encoding: "utf8" }).trim();

const problems = [];
if (haveNode !== wantNode) problems.push(`Node ${haveNode} is running; .node-version pins ${wantNode}.`);
if (havePnpm !== wantPnpm) problems.push(`pnpm ${havePnpm} is running; package.json pins ${wantPnpm}.`);

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Node ${haveNode}, pnpm ${havePnpm}: as pinned.`);
