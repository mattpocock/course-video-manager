import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The repo-root `.env`, and the one parser that reads it.
 *
 * Lives under `app/services/` rather than `app/cli/` because both sides of
 * the app need it: `cvm publish` / `footage transcribe` / `clip-mockup add`
 * load it before building a config-reading layer, and so does
 * `resolveClipMockupSpeech`, which the video editor's Clip Mockup list calls
 * over a web route (#1672). `app/cli/env.ts` builds its CLI-edge resolvers
 * (`ensureApiConfig`, `ensureDatabaseUrl`, `isLocalMachine`) on top of these.
 *
 * Everything here is anchored to THIS MODULE, never to the working directory:
 * the globally-linked `cvm` bin imports it from inside the repo, so the walk
 * lands on the repo root wherever `cvm` was invoked from.
 */

/**
 * Walk up from `start` until the WORKSPACE root is found — the directory holding
 * `pnpm-workspace.yaml`. Not the first `package.json`: since the split into
 * `apps/local` and `packages/core` that would stop at `apps/local`, one level
 * below the single `.env` the whole monorepo shares.
 */
export const findRepoRoot = (start: string): string | undefined => {
  let dir = start;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

/** The workspace root above THIS module, or `undefined` when there is none. */
export const installLocationRepoRoot = (): string | undefined =>
  findRepoRoot(import.meta.dirname);

/**
 * The repo-root `.env`, located from THIS MODULE rather than the working
 * directory.
 *
 * `undefined` when there is no workspace root above this module or no `.env` in
 * it, which is the ordinary case on a Remote Box: there, every setting is a
 * real environment variable and the walk is expected to find nothing.
 */
export const repoEnvPath = (): string | undefined => {
  const repoRoot = installLocationRepoRoot();
  if (repoRoot === undefined) return undefined;

  const envPath = join(repoRoot, ".env");
  return existsSync(envPath) ? envPath : undefined;
};

/**
 * Minimal KEY=VALUE `.env` parse: every assignment in the file, in order,
 * comments and blank lines skipped and one layer of matching quotes stripped.
 *
 * ONE parser, because every caller reads the same file and any disagreement
 * between them about what a line means is a setting that is visible to
 * `cvm publish` and invisible to everything else (or the reverse).
 */
export function* envEntries(
  envPath: string
): Generator<readonly [string, string]> {
  const contents = readFileSync(envPath, "utf8");

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (key === "") continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    yield [key, value];
  }
}

/** The first value `key` is assigned in the `.env` file at `envPath`. */
export const readEnvValue = (
  envPath: string,
  key: string
): string | undefined => {
  for (const [candidate, value] of envEntries(envPath)) {
    if (candidate === key) return value;
  }
  return undefined;
};

/**
 * Load EVERY key from the repo-root `.env` into `process.env` (never
 * overwriting a value already set), anchored to the install location the same
 * way `ensureDatabaseUrl` is.
 *
 * Read-only `cvm` commands need only DATABASE_URL, so the hot path stays lean.
 * The Publish flow is the exception: it reaches for config the read services
 * never touch (FINISHED_VIDEOS_DIRECTORY, DROPBOX_REMOTE_PATH, OPENAI_API_KEY — the
 * last read at VideoProcessingService BUILD time), and Effect's default
 * ConfigProvider resolves those from process.env. tsx does not auto-load `.env`,
 * so the `publish` command calls this first to make the whole file visible.
 *
 * Best-effort: a missing/unreadable `.env` is a no-op — any config that stays
 * absent surfaces as its own Config error when Publish actually reads it.
 */
export const loadRepoEnv = (): void => {
  const envPath = repoEnvPath();
  if (envPath === undefined) return;

  try {
    for (const [key, value] of envEntries(envPath)) {
      if (process.env[key] == null) process.env[key] = value;
    }
  } catch {
    // Best-effort: an unreadable `.env` leaves every setting to surface as its
    // own Config error when Publish actually reads it.
  }
};

/**
 * Resolve ONE setting the way every `cvm` setting resolves: an already-set
 * environment variable wins, otherwise the value assigned in the repo-root
 * `.env` found by walking up from this module.
 *
 * Use this rather than reading `process.env` directly for anything a CLI verb
 * needs. tsx does not auto-load `.env`, and `loadRepoEnv` only runs on the few
 * paths that ask for it — so a bare `process.env` read answers DIFFERENTLY
 * depending on which branch of a command ran first. That is exactly how
 * `clip-mockup update` came to write a frame into the fallback store while
 * `add` wrote into the real one.
 */
export const resolveRepoEnvValue = (key: string): string | undefined => {
  const existing = process.env[key];
  if (existing != null && existing !== "") return existing;

  const envPath = repoEnvPath();
  if (envPath === undefined) return undefined;

  const value = readEnvValue(envPath, key);
  return value === "" ? undefined : value;
};
