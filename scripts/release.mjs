// Publishes a release: gate, build, changelog commit, tag, then (after confirmation) push and
// `gh release create` with the installer and the .vsix attached.
// Usage: pnpm release "<title>"
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { releaseChangelog } from "./release-changelog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = "dseelinger/wysidown";

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
  console.error(`\nRELEASE FAILED: ${message}`);
  process.exit(1);
}

const title = process.argv.slice(2).join(" ").trim();
if (title === "") fail('give the release a title: pnpm release "First release".');

const desktopVersion = version("apps/desktop/package.json");
if (version("apps/vscode/package.json") !== desktopVersion) {
  fail("the desktop app and the extension have different versions.");
}
const tag = `v${desktopVersion}`;

if (capture("git branch --show-current").stdout.trim() !== "main") fail("the current branch is not main.");
if (capture("git status --porcelain").stdout.trim() !== "") fail("the working tree is not clean.");
if (capture(`git rev-parse --verify --quiet refs/tags/${tag}`).status === 0) fail(`the tag ${tag} already exists.`);
if (capture("gh auth status").status !== 0) fail("gh is not signed in. Run gh auth login.");
if (capture(`gh release view ${tag} --repo ${repo}`).status === 0) fail(`${repo} already has a release ${tag}.`);

const changelogPath = join(root, "CHANGELOG.md");
const released = releaseChangelog(readFileSync(changelogPath, "utf8"), desktopVersion, title);

run("pnpm gate");
run("pnpm --filter @wysidown/desktop installer");
run("pnpm --filter wysidown package");

const installer = join(root, "apps", "desktop", "release", `Wysidown-Setup-${desktopVersion}.exe`);
const vsix = join(root, "apps", "vscode", "release", `wysidown-${desktopVersion}.vsix`);
copyFileSync(join(root, "apps", "vscode", "release", "wysidown.vsix"), vsix);
for (const file of [installer, vsix]) if (!existsSync(file)) fail(`${file} was not built.`);

writeFileSync(changelogPath, released.text);
run("git add CHANGELOG.md");
run(`git commit -m "Release ${desktopVersion}: ${title}"`);
run(`git tag ${tag}`);

const notesFile = join(mkdtempSync(join(tmpdir(), "wysidown-release-")), "notes.md");
writeFileSync(notesFile, released.notes + "\n");

console.log(`
Ready to publish ${tag} — ${title}
  Files: ${installer}
         ${vsix}
  Notes:
${released.notes
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}

This pushes main and ${tag} to origin and creates the GitHub release.`);
const prompt = createInterface({ input: process.stdin, output: process.stdout });
const answer = await prompt.question("Type yes to push and publish: ");
prompt.close();
if (answer.trim().toLowerCase() !== "yes") {
  console.log(`Stopped. The commit and the tag ${tag} are local; nothing was pushed.`);
  process.exit(1);
}

run("git push origin main");
run(`git push origin ${tag}`);
run(
  `gh release create ${tag} --repo ${repo} --verify-tag --title "${tag} — ${title}" --notes-file "${notesFile}" "${installer}" "${vsix}"`,
);
console.log(`\nReleased ${tag}: https://github.com/${repo}/releases/tag/${tag}`);
