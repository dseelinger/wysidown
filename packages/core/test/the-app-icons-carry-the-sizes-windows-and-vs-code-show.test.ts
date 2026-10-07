import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { repoRoot } from "./support/repo.ts";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The width and height in a PNG's header. */
function pngSize(png: Buffer): [number, number] {
  expect(png.subarray(0, 8)).toEqual(pngSignature);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test("the desktop icon holds a PNG for every size Windows shows", () => {
  const ico = readFileSync(join(repoRoot(), "apps", "desktop", "build", "icon.ico"));
  expect(ico.readUInt16LE(2)).toBe(1);
  const sizes: number[] = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const entry = 6 + 16 * i;
    const size = ico.readUInt8(entry) || 256;
    const start = ico.readUInt32LE(entry + 12);
    const image = ico.subarray(start, start + ico.readUInt32LE(entry + 8));
    expect(pngSize(image)).toEqual([size, size]);
    sizes.push(size);
  }
  expect(sizes).toEqual([16, 20, 24, 32, 40, 48, 64, 256]);
});

test("the extension's icon is a 128 pixel PNG that the package includes", () => {
  const dir = join(repoRoot(), "apps", "vscode");
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { icon: string };
  expect(pngSize(readFileSync(join(dir, manifest.icon)))).toEqual([128, 128]);
  expect(readFileSync(join(dir, ".vscodeignore"), "utf8").split(/\r?\n/)).toContain(`!${manifest.icon}`);
});
