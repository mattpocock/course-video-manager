import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve DATABASE_URL anchored to the INSTALL LOCATION (this repo), not the
 * agent's current working directory. The globally-linked `cvm` bin imports this
 * module from inside the repo, so walking up from this module's own path always
 * lands on the repo root regardless of where `cvm` is invoked.
 *
 * Precedence:
 *   1. An already-set process.env.DATABASE_URL WINS (never overwritten).
 *   2. Otherwise the DATABASE_URL line from the repo-root `.env` file.
 *
 * On success the value is written into process.env.DATABASE_URL so
 * DrizzleService (which reads process.env at build time) picks it up.
 *
 * On failure returns { ok: false } carrying a clean DatabaseError-shaped object.
 * The bin edge renders it to stderr and exits 4 — NEVER a raw Effect.die.
 */
export type EnsureDatabaseUrlResult =
  | { readonly ok: true; readonly databaseUrl: string }
  | {
      readonly ok: false;
      readonly error: {
        readonly _tag: "DatabaseError";
        readonly message: string;
      };
    };

/**
 * Walk up from `start` until the WORKSPACE root is found — the directory holding
 * `pnpm-workspace.yaml`. Not the first `package.json`: since the split into
 * `apps/local` and `packages/core` that would stop at `apps/local`, one level
 * below the single `.env` the whole monorepo shares.
 */
const findRepoRoot = (start: string): string | undefined => {
  let dir = start;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

/** Minimal KEY=VALUE .env parser — extracts a single key. */
const readEnvValue = (envPath: string, key: string): string | undefined => {
  const contents = readFileSync(envPath, "utf8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
};

/**
 * The two values `cvm` needs to reach the deployed API. Same resolution rules
 * as DATABASE_URL: an already-set environment variable wins, otherwise the
 * repo-root `.env` found by walking up from THIS MODULE — so `cvm` keeps
 * working from any working directory, including on a box where the only thing
 * checked out is the repo itself.
 *
 * On a remote box neither of these lives in a file: they are set as real
 * environment variables and the `.env` walk simply finds nothing.
 */
export type EnsureApiConfigResult =
  | { readonly ok: true; readonly baseUrl: string; readonly token: string }
  | {
      readonly ok: false;
      readonly error: {
        readonly _tag: "ConfigurationError";
        readonly message: string;
      };
    };

/** Resolve one key from process.env, falling back to the repo-root `.env`. */
const resolveEnvKey = (key: string): string | undefined => {
  const existing = process.env[key];
  if (existing != null && existing !== "") return existing;

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(moduleDir);
  if (repoRoot === undefined) return undefined;

  const envPath = join(repoRoot, ".env");
  if (!existsSync(envPath)) return undefined;

  const value = readEnvValue(envPath, key);
  return value === "" ? undefined : value;
};

export const API_URL_ENV_KEY = "CVM_API_URL";
export const API_TOKEN_ENV_KEY = "CVM_API_TOKEN";

export const ensureApiConfig = (): EnsureApiConfigResult => {
  const baseUrl = resolveEnvKey(API_URL_ENV_KEY);
  const token = resolveEnvKey(API_TOKEN_ENV_KEY);

  const missing = [
    baseUrl == null ? API_URL_ENV_KEY : undefined,
    token == null ? API_TOKEN_ENV_KEY : undefined,
  ].filter((key): key is string => key !== undefined);

  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        _tag: "ConfigurationError",
        message: `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set. cvm reaches the domain data over HTTP: set ${API_URL_ENV_KEY} to the deployed Course Video Manager API and ${API_TOKEN_ENV_KEY} to a token minted from its UI.`,
      },
    };
  }

  process.env[API_URL_ENV_KEY] = baseUrl;
  process.env[API_TOKEN_ENV_KEY] = token;
  return { ok: true, baseUrl: baseUrl!, token: token! };
};

export const ensureDatabaseUrl = (): EnsureDatabaseUrlResult => {
  const existing = process.env.DATABASE_URL;
  if (existing != null && existing !== "") {
    return { ok: true, databaseUrl: existing };
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(moduleDir);
  if (repoRoot === undefined) {
    return {
      ok: false,
      error: {
        _tag: "DatabaseError",
        message:
          "Could not locate the course-video-manager workspace root from the cvm install location.",
      },
    };
  }

  const envPath = join(repoRoot, ".env");
  if (!existsSync(envPath)) {
    return {
      ok: false,
      error: {
        _tag: "DatabaseError",
        message: `DATABASE_URL is not set and no .env file was found at ${envPath}.`,
      },
    };
  }

  const value = readEnvValue(envPath, "DATABASE_URL");
  if (value == null || value === "") {
    return {
      ok: false,
      error: {
        _tag: "DatabaseError",
        message: `DATABASE_URL is not set and was not found in ${envPath}.`,
      },
    };
  }

  process.env.DATABASE_URL = value;
  return { ok: true, databaseUrl: value };
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
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(moduleDir);
  if (repoRoot === undefined) return;

  const envPath = join(repoRoot, ".env");
  if (!existsSync(envPath)) return;

  let contents: string;
  try {
    contents = readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === "" || process.env[key] != null) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
};
