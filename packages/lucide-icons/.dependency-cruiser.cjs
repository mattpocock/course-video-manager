// @ts-check
//
// Deep-module enforcement for `@cvm/lucide-icons`.
//
// This package used to live under `apps/local/app/packages/`, where the app's
// own `.dependency-cruiser.cjs` (rooted at `app/packages`) enforced its
// boundary. Moving it to a top-level workspace package took it out of that
// config's reach, so the rules travel with it: this file restates them at
// package scope, and `pnpm lint:boundaries` runs it through turbo like every
// other package's.
//
// The package's PUBLIC SURFACE is its root files — `index.ts`, `generator.ts`
// and `tldraw.ts`, which are exactly the three `exports` in its package.json.
// `lib/` is implementation and `tests/` is tests; both are private. Outside
// consumers are held to that by the `exports` map (a bare `@cvm/lucide-icons/
// lib/search` does not resolve) and, for `apps/local`'s historical
// `@/packages/lucide-icons` alias, by that alias naming one exact file rather
// than a prefix. What is left for this config is everything INSIDE the
// package.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "tests-through-entrypoints",
      comment:
        "A package's tests exercise it through its entry points like everyone else. Import ../index, ../generator or ../tldraw, never lib/.",
      severity: "error",
      from: { path: "^tests/" },
      to: { path: "^lib/" },
    },
    {
      name: "tests-folder-is-private",
      comment:
        "The tests/ folder is reachable only from tests — nothing else may import a fixture.",
      severity: "error",
      from: { pathNot: "^tests/" },
      to: { path: "^tests/" },
    },
    {
      name: "data-entry-point-stays-tldraw-free",
      comment:
        "index.ts is the DATA half. The server path (extract-scene-text) resolves icon names through it and must not pull tldraw into that bundle, so tldraw stays behind the separate ./tldraw entry point — including transitively.",
      severity: "error",
      from: { path: "^index\\.ts$" },
      to: { path: "node_modules/tldraw", reachable: true },
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
    // No `tsConfig` here, unlike the other packages' configs: handing this
    // package's tsconfig to dependency-cruiser makes a bare `"tldraw"` resolve
    // to this package's OWN `tldraw.ts` entry point instead of to the npm
    // package, which then reads as a dependency cycle that is not there.
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
