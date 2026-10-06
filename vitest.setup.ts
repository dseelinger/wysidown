import { afterEach, beforeEach, vi } from "vitest";

// A test that logs a warning or an error fails, even when the code that logged it carried on.
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  for (const level of ["warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(`console.${level}: ${args.map(String).join(" ")}`);
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  if (logged.length > 0) throw new Error(logged.join("\n"));
});
