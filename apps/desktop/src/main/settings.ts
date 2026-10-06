import { readFile, writeFile } from "node:fs/promises";

/** Settings kept between runs. */
export interface Settings {
  /** True when images from the web are loaded. */
  remoteImages: boolean;
}

const defaults: Settings = { remoteImages: true };

/** Reads the settings in the JSON file at `path`, taking the default for any that is missing or malformed. */
export async function readSettings(path: string): Promise<Settings> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return { ...defaults };
  }
  const remoteImages = (json as { remoteImages?: unknown } | null)?.remoteImages;
  return { remoteImages: typeof remoteImages === "boolean" ? remoteImages : defaults.remoteImages };
}

/** Writes `settings` to the JSON file at `path`. */
export async function writeSettings(path: string, settings: Settings): Promise<void> {
  await writeFile(path, JSON.stringify(settings, null, 2) + "\n", "utf8");
}
