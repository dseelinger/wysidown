/** The themes the window can show. */
export const themes = ["vscode", "github"] as const;

export type Theme = (typeof themes)[number];

/** True when `value` names a theme. */
export function isTheme(value: unknown): value is Theme {
  return themes.includes(value as Theme);
}
