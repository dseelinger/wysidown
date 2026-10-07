import { readFile, writeFile } from "node:fs/promises";
import { isTheme, type Theme } from "../renderer/theme.ts";

/** Settings kept between runs. */
export interface Settings {
  /** True when images from the web are loaded. */
  remoteImages: boolean;
  /** How the document looks. */
  theme: Theme;
}

export const defaults: Settings = { remoteImages: true, theme: "vscode" };

/** Reads the settings in the JSON file at `path`, taking the default for any that is missing or malformed. */
export async function readSettings(path: string): Promise<Settings> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return { ...defaults };
  }
  const { remoteImages, theme } = (json ?? {}) as { remoteImages?: unknown; theme?: unknown };
  return {
    remoteImages: typeof remoteImages === "boolean" ? remoteImages : defaults.remoteImages,
    theme: isTheme(theme) ? theme : defaults.theme,
  };
}

/** Writes `settings` to the JSON file at `path`. */
export async function writeSettings(path: string, settings: Settings): Promise<void> {
  await writeFile(path, JSON.stringify(settings, null, 2) + "\n", "utf8");
}
