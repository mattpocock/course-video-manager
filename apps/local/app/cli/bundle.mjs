/**
 * The `cvm` CLI runs on PLAIN Node from an esbuild bundle of `main.ts` — no tsx
 * at runtime. Booting tsx and transpiling the whole command tree on every call
 * cost ~2s per call, even for `--help`; loading a prebuilt bundle costs a few
 * hundred milliseconds.
 *
 * The bundle CANNOT GO STALE. It lives in this checkout's
 * `node_modules/.cache/cvm-cli/` (never committed) beside a manifest of every
 * source file it was built from and that file's mtime and size, plus pnpm's
 * record of what is installed. Each call stats those files; if any changed,
 * appeared or vanished, the bundle is rebuilt (~1–2s, once) before it runs. A `git pull`, a branch switch or an edit is
 * therefore picked up on the very next call, with no build step to remember.
 *
 * What the bundle does and does not contain:
 *   - this app's sources and the workspace TS packages (`@cvm/*`) are bundled,
 *     with the tsconfig `@/*` aliases resolved;
 *   - so are `effect`, `@effect/*` and `drizzle-orm`: they are hundreds of small modules each, and resolving and
 *     loading them file by file was most of what remained of the start-up
 *     after tsx was gone;
 *   - every other npm package stays EXTERNAL and loads from node_modules as it
 *     always did, so a native or heavy dependency never has to be bundleable;
 *   - `import.meta.url` / `.dirname` / `.filename` are rewritten per file to
 *     the ORIGINAL source location, so code that anchors itself to its install
 *     location (the repo-root `.env` walk, the git-worktree probe, the Clip
 *     Mockup daemon's launcher path) sees exactly what it saw under tsx.
 */
import { enableCompileCache } from "node:module";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../..");

export const DEFAULT_CACHE_DIR = resolve(
  appRoot,
  "node_modules/.cache/cvm-cli"
);
const ENTRY = resolve(here, "main.ts");
const TSCONFIG = resolve(appRoot, "tsconfig.json");

/**
 * Files that shape the bundle without being in its import graph. A change to
 * any of them rebuilds it too.
 */
const BUILD_INPUTS = [
  fileURLToPath(import.meta.url),
  TSCONFIG,
  // Rewritten by every `pnpm install` that changes what is installed — and so
  // what the bundled npm packages are.
  resolve(appRoot, "../../node_modules/.pnpm/lock.yaml"),
];

/** npm packages that are bundled rather than left external. */
const BUNDLED_PACKAGES = /^(effect|@effect\/[^/]+|drizzle-orm)(\/|$)/;

const fingerprint = async (file) => {
  try {
    const s = await stat(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "missing";
  }
};

/** Whether the bundle in `cacheDir` was built from the sources as they are now. */
export const isBundleFresh = async (cacheDir = DEFAULT_CACHE_DIR) => {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(cacheDir, "manifest.json"), "utf8")
    );
    const checks = await Promise.all(
      Object.entries(manifest.inputs).map(
        async ([file, print]) => (await fingerprint(file)) === print
      )
    );
    return checks.every(Boolean);
  } catch {
    return false;
  }
};

const IMPORT_META = /\bimport\.meta\.(url|dirname|filename)\b/g;

/** Point each file's `import.meta` at where the file lives, not the bundle. */
const originalImportMeta = {
  name: "original-import-meta",
  setup(build) {
    build.onLoad({ filter: /\.(m?[jt]s|tsx)$/ }, async (args) => {
      if (args.path.includes("/node_modules/")) return undefined;
      const source = await readFile(args.path, "utf8");
      if (!source.includes("import.meta.")) return undefined;
      const values = {
        url: pathToFileURL(args.path).href,
        dirname: dirname(args.path),
        filename: args.path,
      };
      const contents = source.replace(IMPORT_META, (_, key) =>
        JSON.stringify(values[key])
      );
      const ext = args.path.split(".").pop();
      return { contents, loader: ext === "tsx" ? "tsx" : "ts" };
    });
  },
};

/**
 * Whatever resolves into node_modules (npm packages) stays external and loads
 * from there at runtime, except BUNDLED_PACKAGES. Everything else — this app's sources through the
 * tsconfig paths (`@/…`, and bare paths like `recorder-service/…` through its
 * `*` catch-all) and the workspace's TS-source packages (`@cvm/…`, which
 * resolve through their symlinks to `packages/`) — is bundled.
 */
const externalNpmPackages = {
  name: "external-npm-packages",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.pluginData === "default-resolve") return undefined;
      const resolved = await build.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
        with: args.with,
        pluginData: "default-resolve",
      });
      // Unresolvable here means an optional peer (`pg-native`, `bufferutil`)
      // its importer only `require`s inside a try: leave it to runtime, as the
      // unbundled package would.
      if (resolved.errors.length > 0)
        return { path: args.path, external: true };
      if (resolved.external) return { path: args.path, external: true };
      if (!resolved.path.includes("/node_modules/")) return resolved;
      if (BUNDLED_PACKAGES.test(args.path)) return resolved;
      // A bundled package's own dependencies would not resolve by name from
      // the bundle's location under pnpm's strict layout, so they are imported
      // by the path they resolved to from their importer — the same file, and
      // so the same module instance, the app gets when it imports them itself.
      if (args.importer.includes("/node_modules/")) {
        return { path: pathToFileURL(resolved.path).href, external: true };
      }
      return { path: args.path, external: true };
    });
  },
};

/** Build the bundle into `cacheDir` and record what it was built from. */
export const buildBundle = async (cacheDir = DEFAULT_CACHE_DIR) => {
  const { build } = await import("esbuild");
  await mkdir(cacheDir, { recursive: true });
  // Unique temp names, then rename: concurrent `cvm` calls may rebuild at once,
  // and none of them may ever import a half-written bundle.
  const tmp = `${process.pid}-${Date.now()}`;
  const outfile = resolve(cacheDir, `cli.${tmp}.mjs`);
  const startedAt = Date.now();
  try {
    const result = await build({
      absWorkingDir: appRoot,
      entryPoints: [ENTRY],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      tsconfig: TSCONFIG,
      metafile: true,
      logLevel: "silent",
      plugins: [externalNpmPackages, originalImportMeta],
    });
    // Sources are fingerprinted one by one; the bundled npm packages through
    // pnpm's lock.yaml in BUILD_INPUTS, rather than thousands of stats a call.
    const sources = Object.keys(result.metafile.inputs)
      .map((f) => resolve(appRoot, f))
      .filter((f) => !f.includes("/node_modules/"));
    const inputs = {};
    for (const file of [...sources, ...BUILD_INPUTS]) {
      const print = await fingerprint(file);
      // A file edited while esbuild was reading it can't be trusted to be in
      // the bundle: record a print it can never match, so the next call
      // rebuilds.
      inputs[file] =
        Number(print.split(":")[0]) >= startedAt
          ? "edited-during-build"
          : print;
    }
    await rename(outfile, resolve(cacheDir, "cli.mjs"));
    const manifestTmp = resolve(cacheDir, `manifest.${tmp}.json`);
    await writeFile(manifestTmp, JSON.stringify({ inputs }));
    await rename(manifestTmp, resolve(cacheDir, "manifest.json"));
  } finally {
    await rm(outfile, { force: true });
  }
};

/** The CLI's `main.ts` module, from a bundle that is fresh for the sources. */
export const loadCli = async (cacheDir = DEFAULT_CACHE_DIR) => {
  if (!(await isBundleFresh(cacheDir))) await buildBundle(cacheDir);
  // V8's compiled code for the bundle, kept between calls (keyed by content,
  // so a rebuilt bundle simply misses it once): parsing 3MB is most of what a
  // call costs once tsx is gone.
  enableCompileCache(resolve(cacheDir, "v8"));
  return import(pathToFileURL(resolve(cacheDir, "cli.mjs")).href);
};
