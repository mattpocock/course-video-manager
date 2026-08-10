// @ts-check
//
// The boundary that makes `@cvm/core` deployable.
//
// This package holds every piece of SQL in the repo, and it is the package the
// remote API will be built from. That API runs on a machine with no finished
// videos directory, no Video Files directory, no ffmpeg, no OBS and no git
// checkout. So the rule is not "please avoid the filesystem" — it is that a
// filesystem import here is a build failure, caught before anything is
// deployed, rather than a runtime error on a box nobody is watching.
//
// Node's crypto is deliberately allowed: content hashing (Export Hashes, scene
// hashes) and the API token hashing this work adds are pure computation.

/** Modules that need a machine. Importing one from `@cvm/core` is an error. */
const FILESYSTEM_BOUND = [
  "^(node:)?fs$",
  "^(node:)?fs/promises$",
  "^(node:)?path$",
  "^(node:)?os$",
  "^(node:)?child_process$",
  "^(node:)?worker_threads$",
  "^(node:)?cluster$",
  "^(node:)?v8$",
  "^(node:)?vm$",
  "^fs-extra$",
  "^graceful-fs$",
  "^glob$",
  "^fast-glob$",
  "^globby$",
  "^rimraf$",
  "^chokidar$",
  "^tmp$",
  "^simple-git$",
  "^isomorphic-git$",
  "^execa$",
  "^cross-spawn$",
  "^shelljs$",
];

/**
 * Tests may reach for a machine. `test-utils/` boots PGlite from a snapshot on
 * disk and `migrations.test.ts` reads the migration SQL — both are the test
 * harness, not the domain, and neither ships.
 */
const TEST_FILE = "(^|/)(test-utils/|[^/]+\\.test\\.tsx?$)";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-is-filesystem-free",
      comment:
        "@cvm/core is deployed to a box with no disk, no ffmpeg and no git checkout. Move whatever needs a machine into apps/local and inject it — see services/diagram-thumbnail-store.ts for the shape.",
      severity: "error",
      from: { pathNot: TEST_FILE },
      to: { dependencyTypes: ["core", "npm"], path: FILESYSTEM_BOUND },
    },
    {
      name: "core-does-not-import-the-apps",
      comment:
        "@cvm/core is the shared bottom of the graph. Nothing above it — the React Router app, the CLI, the deployed API — may be imported from here.",
      severity: "error",
      from: {},
      to: { path: "^(\\.\\./)+(apps/|app/)" },
    },
    {
      name: "no-circular",
      comment: "No dependency cycles.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
