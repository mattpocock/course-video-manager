import os from "node:os";
import { defineConfig } from "vitest/config";

// Match the fork count to the runner's core count on CI (the suite is
// CPU-bound, so more forks than cores just oversubscribes); cap at 5 locally to
// leave headroom. Same reasoning as apps/local.
const isCI = !!process.env.CI;
const maxForks = isCI ? Math.max(1, os.availableParallelism()) : 5;

/**
 * The domain database's own suite. Every test here runs the real services over
 * PGlite (ADR 0014), nothing mocks a module, so one shared non-isolated project
 * is enough — the `isolated` project apps/local needs has no counterpart here.
 */
export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: { forks: { maxForks } },
    isolate: false,
    globalSetup: ["./test-utils/global-setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
