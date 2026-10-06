import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const fence = "````````````````````````````````";
const lines = readFileSync("corpus/spec.txt", "utf8").split("\n");
mkdirSync("corpus/spec", { recursive: true });
let n = 0;
let section = "";
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]!;
  const heading = /^#{1,6} (.*)$/.exec(line);
  if (heading) section = heading[1]!;
  if (!line.startsWith(fence + " example")) continue;
  const md: string[] = [];
  i++;
  while (lines[i] !== ".") md.push(lines[i++]!);
  while (lines[i] !== fence) i++;
  n++;
  const slug = section.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const text = md.join("\n").replace(/→/g, "\t") + (md.length ? "\n" : "");
  writeFileSync(`corpus/spec/${String(n).padStart(3, "0")}-${slug}.md`, text);
}
console.log(n);
