import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  projects: [{ name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } }],
  webServer: {
    command: "pnpm exec vite preview",
    url: "http://localhost:4173",
    reuseExistingServer: false,
  },
  use: { baseURL: "http://localhost:4173" },
});
