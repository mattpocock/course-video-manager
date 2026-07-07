import os from "node:os";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// On CI (GitHub Actions sets CI=true) match the fork count to the runner's
// core count — the suite is CPU-bound, so spawning more forks than cores just
// oversubscribes and wastes memory. Locally, cap at 5 to leave headroom.
const isCI = !!process.env.CI;
const maxForks = isCI ? Math.max(1, os.availableParallelism()) : 5;

const ISOLATED_TEST_FILES = [
  "app/services/cloudinary-markdown-service.test.ts",
  "app/features/upload-manager/consume-sse-stream.test.ts",
  "app/features/upload-manager/upload-toasts.test.ts",
  "app/features/video-editor/use-audio-boost.test.ts",
  ".sandcastle/run-with-extraction.test.ts",
  ".sandcastle/run-with-retry.test.ts",
];

const COMMON_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.react-router/**",
  "**/.sandcastle/worktrees/**",
];

export default defineConfig({
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
          globalSetup: ["./app/test-utils/global-setup.ts"],
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
