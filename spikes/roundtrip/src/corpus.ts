import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Variant = "lf" | "crlf" | "bom" | "no-final-newline";
export const variants: Variant[] = ["lf", "crlf", "bom", "no-final-newline"];

export interface Fixture {
  set: "realistic" | "spec";
  name: string;
  text: string;
}

export function load(set: Fixture["set"]): Fixture[] {
  const dir = join(import.meta.dirname, "..", "corpus", set);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((name) => ({ set, name, text: readFileSync(join(dir, name), "utf8") }));
}

export function variant(text: string, v: Variant): string {
  switch (v) {
    case "lf":
      return text;
    case "crlf":
      return text.replace(/\n/g, "\r\n");
    case "bom":
      return "﻿" + text;
    case "no-final-newline":
      return text.replace(/\n+$/, "");
  }
}
