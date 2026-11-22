import { defineConfig } from "vitest/config";

/**
 * The workspace root's own suite: the Sandcastle agent harness in
 * `.sandcastle/`, the monorepo layout tests in `tests/`, and the local Oxlint
 * plugin's rule tests in `lint/`. Everything else
 * lives in a workspace package and is run by `turbo run test`.
 *
 * Isolated by default (vitest's default) because the `.sandcastle` tests mock
 * modules — see ADR 0014 for why that matters.
 */
export default defineConfig({
  test: {
    include: [
      ".sandcastle/**/*.test.ts",
      "tests/**/*.test.ts",
      "lint/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", ".sandcastle/worktrees/**"],
    pool: "forks",
  },
});
