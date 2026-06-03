import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins:
    process.env.NODE_ENV === "test"
      ? [tsconfigPaths()]
      : [tailwindcss(), reactRouter(), tsconfigPaths()],
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.react-router/**",
      "**/.sandcastle/worktrees/**",
    ],
    globalSetup: ["./app/test-utils/global-setup.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 5,
      },
    },
  },
});
