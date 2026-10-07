// Builds and packages both apps, then installs the extension into the VS Code on PATH.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const exe = `${root}apps\\desktop\\release\\win-unpacked\\Wysidown.exe`;
const vsix = `${root}apps\\vscode\\release\\wysidown.vsix`;

function version(manifest) {
  return JSON.parse(readFileSync(`${root}${manifest}`, "utf8")).version;
}

function capture(command) {
  return spawnSync(command, { cwd: root, encoding: "utf8", shell: true });
}

function run(command) {
  console.log(`\n=== ${command}`);
  const result = spawnSync(command, { cwd: root, stdio: "inherit", shell: true });
  if (result.status !== 0) fail(`${command} failed (exit ${result.status ?? result.signal}).`);
}

function fail(message) {
  console.error(`\nLOCAL FAILED: ${message}`);
  process.exit(1);
}

const tasks = capture('tasklist /FI "IMAGENAME eq Wysidown.exe" /FO CSV /NH');
if (tasks.stdout.includes('"Wysidown.exe"')) {
  fail("Wysidown.exe is running, so its folder cannot be replaced. Close it and run again.");
}
if (capture("code --version").status !== 0) {
  fail("the code command is not on PATH. Add VS Code's bin folder to PATH, then open a new terminal.");
}

run("pnpm build");
run("pnpm package");
run(`code --install-extension "${vsix}" --force`);

const built = `dseelinger.wysidown@${version("apps/vscode/package.json")}`;
const listed = capture("code --list-extensions --show-versions").stdout.split(/\r?\n/);
if (!listed.includes(built)) fail(`${built} is not in VS Code's extension list after installing.`);

console.log(`
Desktop app ${version("apps/desktop/package.json")}: ${exe}
  Open a file with: "${exe}" path\\to\\file.md, or File > Open.
VS Code extension installed: ${built}
  Reload open VS Code windows (Developer: Reload Window), then use Open With... > Wysidown on a .md file.`);
