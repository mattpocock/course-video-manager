import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const ISOLATED_TEST_FILES = [
  "app/services/cloudinary-markdown-service.test.ts",
  "app/hooks/use-fs-git-status.test.ts",
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
        maxForks: 5,
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
