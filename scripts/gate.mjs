// The release gate: every check, in order, stopping at the first failure.
// `--no-e2e` skips the end-to-end tests, the only step that opens windows.
import { spawnSync } from "node:child_process";

const skipE2e = process.argv.includes("--no-e2e");

const allSteps = [
  ["toolchain", "node scripts/check-toolchain.mjs"],
  ["install", "pnpm install --frozen-lockfile"],
  ["format", "pnpm format:check"],
  ["lint", "pnpm lint"],
  ["typecheck", "pnpm typecheck"],
  ["unit tests", "pnpm test"],
  ["build", "pnpm build"],
  ["end-to-end tests", "pnpm e2e"],
  ["package", "pnpm package"],
];
const steps = skipE2e ? allSteps.filter(([name]) => name !== "end-to-end tests") : allSteps;

const started = Date.now();
for (const [name, command] of steps) {
  const t = Date.now();
  console.log(`\n=== ${name}: ${command}`);
  const result = spawnSync(command, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`\nGATE FAILED at ${name} (exit ${result.status ?? result.signal}).`);
    process.exit(1);
  }
  console.log(`=== ${name}: passed in ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
const scope = skipE2e ? " without end-to-end tests" : "";
console.log(`\nGATE PASSED${scope} in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
