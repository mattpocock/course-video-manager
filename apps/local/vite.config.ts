import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// On CI (GitHub Actions sets CI=true) match the fork count to the runner's
// core count — the suite is CPU-bound, so spawning more forks than cores just
// oversubscribes and wastes memory. Locally, cap at 5 to leave headroom.
const isCI = !!process.env.CI;
const maxForks = isCI ? Math.max(1, os.availableParallelism()) : 5;

// The workspace root, two levels up. `.env` lives there — one file for the whole
// monorepo, which is also where `cvm`'s env walk lands (see app/cli/env.ts).
const WORKSPACE_ROOT = path.resolve("../..");

const ISOLATED_TEST_FILES = [
  "app/services/cloudinary-markdown-service.test.ts",
  "app/features/upload-manager/consume-sse-stream.test.ts",
  "app/features/upload-manager/upload-toasts.test.ts",
  "app/features/video-editor/use-audio-boost.test.ts",
];

const COMMON_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.react-router/**",
];

// Git worktrees symlink node_modules back to the main checkout. Vite's dev-time
// file guard resolves symlinks before checking, so the real path lands outside
// the project root and every dependency — including the React Router client
// entry — comes back 403. The page still renders but never hydrates, which
// presents as "buttons don't work" rather than as a server error.
function serveRoots(): string[] {
  // The workspace root is in the list because `packages/core` is imported
  // straight from source through the `@/db/*` and `@/services/db-*` aliases.
  const roots = [path.resolve("."), WORKSPACE_ROOT];
  for (const dir of ["node_modules", "../../node_modules"]) {
    try {
      roots.push(realpathSync(path.resolve(dir)));
    } catch {
      // No node_modules to resolve (fresh clone, or a test run) — nothing to add.
    }
  }
  return roots;
}

export default defineConfig({
  envDir: WORKSPACE_ROOT,
  server: { fs: { allow: serveRoots() } },
  plugins:
    process.env.NODE_ENV === "test"
      ? [tsconfigPaths()]
      : [tailwindcss(), reactRouter(), tsconfigPaths()],
  test: {
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "shared",
          isolate: false,
          exclude: [...COMMON_EXCLUDE, ...ISOLATED_TEST_FILES],
          globalSetup: ["../../packages/core/test-utils/global-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "isolated",
          include: ISOLATED_TEST_FILES,
          exclude: COMMON_EXCLUDE,
        },
      },
    ],
  },
});
