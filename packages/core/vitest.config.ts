import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "core",
    include: ["test/**/*.test.ts"],
    setupFiles: ["../../vitest.setup.ts"],
    execArgv: ["--throw-deprecation"],
  },
});
