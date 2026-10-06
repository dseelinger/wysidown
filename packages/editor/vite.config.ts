import { createLogger, defineConfig } from "vite";

// Build warnings fail the build.
const fail = (msg: string): never => {
  throw new Error(msg);
};
const logger = createLogger();
logger.warn = fail;
logger.warnOnce = fail;

export default defineConfig({
  root: "harness",
  customLogger: logger,
  build: {
    outDir: "../dist/harness",
    emptyOutDir: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
