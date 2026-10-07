// Builds both apps, installs the desktop app for the current user and the extension into the VS Code on PATH.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const desktopVersion = version("apps/desktop/package.json");
const release = join(root, "apps", "desktop", "release");
const installer = join(release, `Wysidown-Setup-${desktopVersion}.exe`);
const installed = join(process.env.LOCALAPPDATA ?? "", "Programs", "wysidown", "Wysidown.exe");
const vsix = join(root, "apps", "vscode", "release", "wysidown.vsix");

function version(manifest) {
  return JSON.parse(readFileSync(join(root, manifest), "utf8")).version;
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

/** The paths of the running Wysidown.exe processes. */
function running() {
  const listed = capture(
    'powershell -NoProfile -Command "Get-Process Wysidown -ErrorAction SilentlyContinue | ForEach-Object Path"',
  );
  return listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

const inside = (dir) => (path) => path.toLowerCase().startsWith(dir.toLowerCase() + "\\");

if (running().some(inside(release))) {
  fail(`Wysidown.exe is running from ${release}, so its folder cannot be replaced. Close it and run again.`);
}
if (capture("code --version").status !== 0) {
  fail("the code command is not on PATH. Add VS Code's bin folder to PATH, then open a new terminal.");
}

run("pnpm build");
run("pnpm --filter @wysidown/desktop installer");
run("pnpm --filter wysidown package");

if (running().some((path) => path.toLowerCase() === installed.toLowerCase())) {
  fail(`the installed Wysidown is running. Close it and run again; the installer replaces ${installed}.`);
}
run(`"${installer}" /S`);
if (!existsSync(installed)) fail(`the installer ran but ${installed} is not there.`);

run(`code --install-extension "${vsix}" --force`);
const built = `dseelinger.wysidown@${version("apps/vscode/package.json")}`;
const listed = capture("code --list-extensions --show-versions").stdout.split(/\r?\n/);
if (!listed.includes(built)) fail(`${built} is not in VS Code's extension list after installing.`);

console.log(`
Desktop app ${desktopVersion} installed: ${installed}
  Start it from the Start menu, or open a .md file with it (Open with > Wysidown).
VS Code extension installed: ${built}
  Reload open VS Code windows (Developer: Reload Window), then use Open With... > Wysidown on a .md file.`);
