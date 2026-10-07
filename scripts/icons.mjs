// Rasterises assets/icon.svg in Edge into the desktop app's icon.ico and the extension's icon.png.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const svg = readFileSync(join(root, "assets", "icon.svg"), "utf8");
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 256];
const ico = join(root, "apps", "desktop", "build", "icon.ico");
const png = join(root, "apps", "vscode", "icon.png");

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ deviceScaleFactor: 1 });

/** The icon as a transparent PNG of `size` by `size` pixels. */
async function render(size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: true });
}

/** An ICO file holding one PNG-compressed image per size. */
function icoFile(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

const images = [];
for (const size of icoSizes) images.push({ size, data: await render(size) });
mkdirSync(dirname(ico), { recursive: true });
writeFileSync(ico, icoFile(images));
writeFileSync(png, await render(128));
await browser.close();
console.log(`wrote ${ico}\nwrote ${png}`);
