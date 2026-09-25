import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  installLocationRepoRoot,
  readEnvValue,
  repoEnvPath,
} from "@/services/repo-env";

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

  const envPath = repoEnvPath();
  if (envPath === undefined) return undefined;

  const value = readEnvValue(envPath, key);
  return value === "" ? undefined : value;
};

export const API_URL_ENV_KEY = "CVM_API_URL";
export const API_TOKEN_ENV_KEY = "CVM_API_TOKEN";

/**
 * How a machine says it is the author's — the one with the finished videos
 * directory, the Video Files directory, ffmpeg and OBS on it.
 *
 * It is DECLARED rather than detected. Every candidate signal is a proxy that
 * is wrong in the dangerous direction: `VIDEO_FILES_DIR` falls back to a path
 * inside the checkout, so a Remote Box would quietly scatter files into
 * whatever repo it had; `DATABASE_URL` is a thing this CLI no longer uses; and
 * probing for ffmpeg answers a question nobody asked. A declaration is also the
 * safe default — a box that has said nothing is treated as remote, so the worst
 * case of forgetting it is a refusal that names itself, not a half-changed
 * Course.
 */
export const LOCAL_MACHINE_ENV_KEY = "CVM_LOCAL_MACHINE";

/**
 * Whether this is the author's machine, resolved the same way every other
 * `cvm` setting is: the environment first, then the repo-root `.env` found by
 * walking up from the install location — so it holds from any working
 * directory, and a Remote Box that sets nothing simply is not local.
 */
export const isLocalMachine = (): boolean => {
  const value = resolveEnvKey(LOCAL_MACHINE_ENV_KEY)?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
};

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

  const repoRoot = installLocationRepoRoot();
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
