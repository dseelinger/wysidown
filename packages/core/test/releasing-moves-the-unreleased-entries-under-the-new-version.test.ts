import { expect, test } from "vitest";
import { releaseChangelog } from "../../../scripts/release-changelog.mjs";

const intro = "# Changelog\n\nNewest first.\n\n";

test("releasing moves the unreleased entries under a heading with the version and title", () => {
  const text = `${intro}## Unreleased\n\n- Second.\n- First.\n\n## 0.0.9 — Older\n\n- Old.\n`;
  const { text: out, notes } = releaseChangelog(text, "0.1.0", "First release");
  expect(notes).toBe("- Second.\n- First.");
  expect(out).toBe(
    `${intro}## Unreleased\n\n## 0.1.0 — First release\n\n- Second.\n- First.\n\n## 0.0.9 — Older\n\n- Old.\n`,
  );
});

test("releasing when the unreleased section is the last one keeps a final newline", () => {
  const { text } = releaseChangelog(`${intro}## Unreleased\n\n- Only.\n`, "0.1.0", "First");
  expect(text).toBe(`${intro}## Unreleased\n\n## 0.1.0 — First\n\n- Only.\n`);
});

test("releasing fails when there are no unreleased entries", () => {
  expect(() => releaseChangelog(`${intro}## Unreleased\n\n## 0.0.9 — Older\n\n- Old.\n`, "0.1.0", "X")).toThrow(
    /no entries/,
  );
});

test("releasing fails when the changelog has no unreleased heading", () => {
  expect(() => releaseChangelog(intro, "0.1.0", "X")).toThrow(/no "## Unreleased"/);
});

test("releasing fails when the version already has a section", () => {
  const text = `${intro}## Unreleased\n\n- New.\n\n## 0.1.0 — Done\n\n- Old.\n`;
  expect(() => releaseChangelog(text, "0.1.0", "Again")).toThrow(/already has a section/);
});
