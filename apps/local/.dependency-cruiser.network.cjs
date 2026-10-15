// @ts-check
// THE NETWORK GUARD's import half (docs/plans/background-jobs-sidecar.md;
// ADR 0032 section 6).
//
// A slow network or AI call the author walks away from is a Job, and the
// Sidecar runs it. `scripts/check-background-jobs.ts` (the `network` guard)
// counts every use of the global `fetch` and of the AI SDK, OpenAI, Anthropic
// and Cloudinary clients, file by file, against a shrink-only allowlist. These
// rules hold the module graph around it, so no wrapper can carry a client past
// that count:
//
// 1. A network client package is imported only by the files on the allowlist's
//    `network` list (read from `scripts/background-jobs-allowlist.json`, so the
//    two lists are one), by the extra entry points named below, and by the
//    Sidecar. A type-only import is not a client.
//
// 2. `app/` reaches the Sidecar only through `sidecar/job-specs.ts` (to
//    enqueue a Job) and what it imports, and never the dev scripts: the
//    `network` guard does not scan either, so neither may hold a call for it.
//
// ADR 0032 section 7 names every entry point, and
// tests/background-jobs-guard.test.ts fails if one is missing there.

const allowlist = require("../../scripts/background-jobs-allowlist.json");

/** @param {string} file a path from the repository root */
const fromAppsLocal = (file) =>
  `^${file.replace(/^apps\/local\//, "").replace(/[.$]/g, "\\$&")}$`;

/** The allowlist's `network` files that live in this app. */
const ALLOWLISTED = /** @type {{ file: string }[]} */ (allowlist.network)
  .map((entry) => entry.file)
  .filter((file) => file.startsWith("apps/local/"))
  .map(fromAppsLocal);

/**
 * Files that import a client package but make no outbound call, each with
 * why. The `network` guard still scans them, and allows them no call.
 */
const EXTRA_ENTRY_POINTS = [
  // The Article Writer's chat in the browser: `DefaultChatTransport` posts to
  // the app's own completions route.
  "^app/features/article-writer/writer-engine\\.tsx$",
  // Builds the writer's model (Anthropic's, or a scripted fake): the agents
  // that use it make the call.
  "^app/services/fake-writer-model\\.ts$",
  // Reads the AI SDK's error classes to tell a writer turn's failures apart.
  "^app/services/writer-stream-errors\\.ts$",
];

/** The Sidecar makes its own calls: that is what it is for. */
const SIDECAR = "^sidecar/";

/** npm packages that call out, resolved into node_modules. */
const NETWORK_PACKAGES = [
  "ai",
  "@ai-sdk/(?!react/)[^/]+",
  "@openrouter/[^/]+",
  "openai",
  "@anthropic-ai/sdk",
  "cloudinary",
  "undici",
  "node-fetch",
  "axios",
  "got",
  "ky",
  "googleapis",
  "@googleapis/[^/]+",
  "dropbox",
]
  .map((name) => `node_modules/${name}/`)
  .join("|");

/** Node's own clients for another machine (`http` serves local sockets). */
const NETWORK_CORE_MODULES = "^(node:)?(https|http2|tls)$";

/** What `sidecar/job-specs.ts` needs to enqueue a Job. */
const JOB_SPECS =
  "^sidecar/(job-specs|job-kind|job-params|lanes|retry-policy)\\.ts$";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "network-client-outside-entry-points",
      comment:
        "Only the files on the `network` allowlist (scripts/background-jobs-allowlist.json) and the entry points in .dependency-cruiser.network.cjs import a network or AI client. A slow call the author walks away from is a Job: docs/plans/background-jobs-sidecar.md.",
      severity: "error",
      from: {
        pathNot: [...ALLOWLISTED, ...EXTRA_ENTRY_POINTS, SIDECAR].join("|"),
      },
      to: {
        path: `${NETWORK_PACKAGES}|${NETWORK_CORE_MODULES}`,
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "app-reaches-unscanned-code",
      comment:
        "app/ reaches the Sidecar only through sidecar/job-specs.ts, and never the dev scripts: the network guard does not scan them. Enqueue a Job: docs/plans/background-jobs-sidecar.md.",
      severity: "error",
      from: { path: "^app/" },
      to: {
        path: "^(sidecar/|scripts/|playground\\.ts$)",
        pathNot: JOB_SPECS,
        reachable: true,
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "\\.(test|spec)\\.tsx?$|/test-utils/" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
