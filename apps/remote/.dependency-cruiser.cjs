// @ts-check
//
// The boundary that makes `apps/remote` deployable.
//
// This app runs on Vercel: no finished videos directory, no Video Files
// directory, no ffmpeg, no OBS, no git checkout. The rule is the same one
// `packages/core` carries — a filesystem import here is a BUILD failure, caught
// before anything ships, rather than a runtime error on a box nobody is
// watching.
//
// Node's crypto is deliberately allowed: hashing a presented API token is pure
// computation.

/** Modules that need a machine. Importing one from `apps/remote` is an error. */
const FILESYSTEM_BOUND = [
  "^(node:)?fs$",
  "^(node:)?fs/promises$",
  "^(node:)?path$",
  "^(node:)?os$",
  "^(node:)?child_process$",
  "^(node:)?worker_threads$",
  "^(node:)?cluster$",
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

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "remote-is-filesystem-free",
      comment:
        "apps/remote is deployed to a box with no disk, no ffmpeg and no git checkout. Whatever needs a machine belongs in apps/local, behind a local-only command.",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["core", "npm"], path: FILESYSTEM_BOUND },
    },
    {
      name: "remote-does-not-import-local",
      comment:
        "apps/remote may share `packages/core` with apps/local and nothing else. Importing apps/local would drag OBS, ffmpeg and the finished videos directory into the deployed app.",
      severity: "error",
      from: {},
      to: { path: "^(\\.\\./)+apps/local" },
    },
    {
      name: "remote-cannot-reach-third-party-credentials",
      comment:
        "The YouTube, Dropbox and AI Hero credentials live in the same database because they must, but they get NO RPC surface — so a leaked API token cannot become a leaked YouTube refresh token. That guarantee is 'these endpoints do not exist', and LinkAuthOperationsService is the door. (The TABLES are unavoidably reachable: Drizzle needs the whole schema to open a connection. This rule guards the service, which is the only thing that reads them.)",
      severity: "error",
      from: {},
      to: { path: "db-link-auth-operations" },
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
