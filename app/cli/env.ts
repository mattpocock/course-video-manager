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

/** Walk up from `start` until a directory containing package.json is found. */
const findRepoRoot = (start: string): string | undefined => {
  let dir = start;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
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
          "Could not locate the course-video-manager repo root from the cvm install location.",
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
