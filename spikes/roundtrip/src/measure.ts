import { writeFileSync, mkdirSync } from "node:fs";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { load, variant, variants, type Fixture } from "./corpus.ts";

interface Candidate {
  name: string;
  init?: () => Promise<void>;
  roundTrip(src: string): string;
}

const names = process.argv.slice(2);
const html = (s: string) =>
  micromark(s.replace(/^﻿/, "").replace(/\r\n/g, "\n"), {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
    allowDangerousHtml: true,
  }).trim();

const fixtures: Fixture[] = [...load("realistic"), ...load("spec")];
mkdirSync("out", { recursive: true });
const rows: string[] = [];

for (const name of names) {
  const c: Candidate = (await import(`./candidates/${name}.ts`))[name];
  if (c.init) await c.init();
  const stats: Record<
    string,
    { total: number; identical: number; sameHtml: number; threw: number; logged: number }
  > = {};
  const failures: Record<string, string> = {};
  for (const f of fixtures) {
    for (const v of variants) {
      if (f.set === "spec" && v !== "lf") continue;
      const key = `${f.set}/${v}`;
      const s = (stats[key] ??= { total: 0, identical: 0, sameHtml: 0, threw: 0, logged: 0 });
      s.total++;
      const src = variant(f.text, v);
      let out: string;
      let logged = false;
      const orig = console.error;
      console.error = () => {
        logged = true;
      };
      try {
        out = c.roundTrip(src);
      } catch (e) {
        s.threw++;
        failures[`${key}/${f.name}`] = `THREW: ${(e as Error).message}`;
        continue;
      } finally {
        console.error = orig;
      }
      if (logged) s.logged++;
      if (out === src) {
        s.identical++;
        s.sameHtml++;
        continue;
      }
      if (html(out) === html(src)) s.sameHtml++;
      if (v === "lf") failures[`${key}/${f.name}`] = out;
    }
  }
  writeFileSync(`out/${name}-failures.json`, JSON.stringify(failures, null, 1));
  for (const [key, s] of Object.entries(stats)) {
    rows.push(
      `| ${name} | ${key} | ${s.total} | ${s.identical} | ${s.sameHtml} | ${s.threw} | ${s.logged} |`,
    );
  }
}
console.log("| candidate | set/variant | files | byte-identical | same HTML | threw | logged an error |");
console.log("| --- | --- | --: | --: | --: | --: | --: |");
console.log(rows.join("\n"));
