import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
});
