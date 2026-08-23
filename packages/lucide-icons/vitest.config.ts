import { defineConfig } from "vitest/config";

// Local config so this package's tests do not inherit the CVM app's root
// vite.config.ts (global setup, DB, react-router plugins). The icon table is
// plain data: its tests need nothing but vitest.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["tests/**/*.test.ts"],
  },
});
