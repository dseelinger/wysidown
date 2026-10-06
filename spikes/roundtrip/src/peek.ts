import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
const src = (await import("node:fs")).readFileSync(process.argv[2]!, "utf8");
const t = fromMarkdown(src, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
const show = (n: any, d = 0): void => {
  const p = n.position;
  console.log(" ".repeat(d * 2) + n.type, p ? `${p.start.offset}-${p.end.offset}` : "", JSON.stringify(src.slice(p?.start.offset, p?.end.offset)), n.checked ?? "", n.value !== undefined ? "v=" + JSON.stringify(n.value) : "");
  for (const c of n.children ?? []) show(c, d + 1);
};
show(t);
