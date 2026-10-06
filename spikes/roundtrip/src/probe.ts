import { readFileSync } from "node:fs";
const which = process.argv[2]!;
const file = process.argv[3]!;
const mod = await import(`./candidates/${which}.ts`);
const c = mod[which];
if (c.init) await c.init();
const src = readFileSync(file, "utf8");
const out = c.roundTrip(src);
process.stdout.write(out === src ? "IDENTICAL\n" : out);
