import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "editor",
    include: ["test/**/*.test.ts"],
    setupFiles: ["../../vitest.setup.ts"],
    execArgv: ["--throw-deprecation"],
  },
});
