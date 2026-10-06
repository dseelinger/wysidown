import { writeFileSync } from "node:fs";
import { load, variant, variants } from "../corpus.ts";
import { identity, wordEdits, markEdits, insertEdits, deleteEdits, taskToggles, type Result } from "./edits.ts";

const checks: Record<string, (s: string) => Result> = {
  word: wordEdits,
  "word with markdown chars": (s) => wordEdits(s, "a*b_[c]`d"),
  bold: markEdits,
  insert: insertEdits,
  delete: deleteEdits,
  toggle: taskToggles,
};
const failures: string[] = [];
console.log("| set/variant | identity | " + Object.keys(checks).join(" | ") + " |");
console.log("| --- | --: |" + Object.keys(checks).map(() => " --: |").join(""));
for (const set of ["realistic", "spec"] as const) {
  for (const v of variants) {
    if (set === "spec" && v !== "lf") continue;
    let id = 0, idTotal = 0;
    const agg: Record<string, [number, number]> = {};
    for (const f of load(set)) {
      const src = variant(f.text, v);
      idTotal++;
      try {
        if (identity(src)) id++;
        else failures.push(`${set}/${v}/${f.name}: identity`);
      } catch (e) {
        failures.push(`${set}/${v}/${f.name}: identity threw ${(e as Error).message}`);
      }
      for (const [name, fn] of Object.entries(checks)) {
        const a = (agg[name] ??= [0, 0]);
        try {
          const r = fn(src);
          a[0] += r.pass;
          a[1] += r.total;
          for (const x of r.failures) failures.push(`${set}/${v}/${f.name}: ${name} ${x}`);
        } catch (e) {
          a[1]++;
          failures.push(`${set}/${v}/${f.name}: ${name} threw ${(e as Error).stack?.split("\n").slice(0, 3).join(" ")}`);
        }
      }
    }
    console.log(`| ${set}/${v} | ${id}/${idTotal} | ` + Object.values(agg).map(([p, t]) => `${p}/${t}`).join(" | ") + " |");
  }
}
writeFileSync("out/proto-failures.txt", failures.join("\n"));
console.log(`\n${failures.length} failures written to out/proto-failures.txt`);
