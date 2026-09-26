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

// The CVM owns 5170-5199 and nothing else: 5172 (Stream Deck forwarder hub
// WebSocket), 5173 (this dev server), 5174 (forwarder HTTP). `strictPort` stops
// Vite drifting onto the next free port when 5173 is busy, because drifting is
// how a second CVM ends up on a port something else already claims. A busy 5173
// means a CVM is already running — read that as an error, not as a reason to
// move. Verification runs take 5200-5299 instead; see
// .claude/skills/verify-cvm/scripts/verify.sh.
const DEV_PORT = 5173;

// A `pnpm start` prints ~700 lines, and ~600 of them are this build reporting
// on itself: one line per emitted asset, one warning per empty route chunk, one
// warning per sourcemap it could not resolve. THE POINT IS THE AGENT (see
// scripts/run-with-log.sh) — an agent reading `start-latest.log` for the stack
// that broke a page has to scroll past all of it, and a 90KB log is 90KB of
// context spent on nothing. What follows removes the volume and keeps the
// signal: every warning Vite would show you by default still shows, and errors
// are untouched.
export default defineConfig(({ command }) => ({
  envDir: WORKSPACE_ROOT,

  // `warn` on a build only. It drops the per-asset size table (419 lines of the
  // 697), `transforming...`, `computing gzip size...` and `built in Ns` — all
  // logged at `info`. Nothing here is read on a normal run, and on a failed one
  // the error is at `error` level and survives. build-if-needed.ts prints the
  // build's duration itself, so the one number worth keeping is not lost.
  //
  // Scoped to `command === "build"` because `serve` is the dev server, where
  // `info` is what prints the local URL and the HMR reloads.
  logLevel: command === "build" ? "warn" : "info",

  build: {
    // The gzip column of a table nobody now prints. It is a synchronous
    // compression pass over every one of ~400 assets, so dropping it is also
    // the single cheapest thing available to the build's wall time.
    reportCompressedSize: false,

    rollupOptions: {
      // Two of rollup's warning codes are structural here — they fire on a
      // healthy build and they cannot be fixed, only heard. Everything else
      // goes to `defaultHandler`, which is Vite's own filter: it is what
      // already hides CIRCULAR_DEPENDENCY and THIS_IS_UNDEFINED from
      // dependencies, and replacing it rather than delegating to it is how you
      // accidentally un-hide 58 more lines.
      onwarn(warning, defaultHandler) {
        // A node builtin reaching the BROWSER bundle is a bug, not a warning.
        // Vite only externalizes one when a module bound for the client imports
        // it, and the module is then shipped with a stub that throws on use —
        // so the page breaks at runtime, in whatever feature touched it, long
        // after the build said nothing much. It used to say nothing much
        // inside 640 other lines.
        //
        // The fix is never to stub the builtin: it is to find what dragged a
        // server module into a component's import graph. `course-json` is the
        // worked example — `index.ts` reaches the Export Hash and so
        // `node:crypto`, and `client.ts` exists for the browser-side callers.
        // Split the module, or move the call into a loader.
        if (
          warning.message.includes(
            "has been externalized for browser compatibility"
          )
        ) {
          throw new Error(
            `Node builtin in the client bundle.\n\n${warning.message}\n\n` +
              "Something bound for the browser imports a server-only module. " +
              "Find the chain and break it — give the package a browser-safe " +
              "entry point (see app/packages/course-json/client.ts) or move the " +
              "call into a loader. Do not stub the builtin."
          );
        }

        // EMPTY_BUNDLE, 118 lines. Every `api.*` route module exports only a
        // loader or an action, so its client chunk is empty by design. React
        // Router builds one chunk per route either way.
        if (warning.code === "EMPTY_BUNDLE") return;

        // SOURCEMAP_ERROR, 92 lines. This is not a warning about your code; it
        // is rollup failing to map a location while reporting one of the
        // warnings `defaultHandler` then suppresses. The suppressed warning
        // never prints and this complaint about it does — noise about silence.
        if (warning.code === "SOURCEMAP_ERROR") return;

        defaultHandler(warning);
      },
    },
  },

  server: { port: DEV_PORT, strictPort: true, fs: { allow: serveRoots() } },
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
}));
