import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "dist-test/**/*.test.cjs",
  version: "1.140.0",
  launchArgs: ["--disable-extensions"],
  mocha: { ui: "tdd", timeout: 20000, forbidOnly: true },
});
