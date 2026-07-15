import { defineConfig } from "vitest/config";

// Local config so this standalone package's test run does not inherit the CVM
// app's root vite.config.ts (global setup, DB, react-router plugins, etc.).
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["tests/**/*.test.ts"],
  },
});
