// Turns the `## Unreleased` section of CHANGELOG.md into a released one.

const UNRELEASED = "## Unreleased";

/**
 * Moves the entries under `## Unreleased` under a new `## <version> — <title>` heading and leaves
 * an empty `## Unreleased` above it. Returns the new changelog and the moved entries as release notes.
 */
export function releaseChangelog(text, version, title) {
  const lines = text.split("\n");
  const start = lines.indexOf(UNRELEASED);
  if (start === -1) throw new Error(`CHANGELOG.md has no "${UNRELEASED}" heading.`);
  let end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  if (end === -1) end = lines.length;

  const notes = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  if (notes === "") throw new Error(`"${UNRELEASED}" in CHANGELOG.md has no entries.`);

  const heading = `## ${version} — ${title}`;
  if (lines.includes(heading) || lines.some((line) => line.startsWith(`## ${version} `))) {
    throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  }

  const before = lines.slice(0, start + 1);
  const after = lines.slice(end);
  const released = [...before, "", heading, "", ...notes.split("\n"), ...(after.length > 0 ? ["", ...after] : [""])];
  return { text: released.join("\n"), notes };
}
