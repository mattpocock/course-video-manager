import { realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath, resolve, sep } from "node:path";
import { Config, ConfigError, Effect, Either } from "effect";
import {
  InvalidStorageRootsError,
  parseStorageRoots,
  STORAGE_FOLDERS,
  writeFolder,
  type StorageRoots,
} from "@/packages/storage";
import {
  realDriveReached,
  realDrivesForbidden,
  VERIFY_RUN_DIR_ENV_KEY,
} from "@/packages/storage/server";
import { resolveRepoEnvValue } from "./repo-env";

/**
 * The ONE place `STORAGE_ROOTS` is read. Everything that needs a Storage Root
 * — or one of the fixed folders under it, which replaced the old
 * FINISHED_VIDEOS_DIRECTORY / CLIP_MOCKUP_DIR / OVERLAY_RENDER_CACHE_DIRECTORY
 * settings — asks here.
 */
export const STORAGE_ROOTS_ENV_KEY = "STORAGE_ROOTS";

/**
 * Set by verify-cvm on every process of a run: that run's own directory.
 * While it is set, every Storage Root — and each Storage Folder under one —
 * must resolve inside it, or the process refuses to start. A verify run once
 * reached Matt's real Footage through a symlinked `raw-footage/`; this is the
 * in-process half of the rule that it never can again (the shell half is
 * verify-cvm's `assert_env_paths_contained`).
 */
export { VERIFY_RUN_DIR_ENV_KEY };

/**
 * Why an agent's process (`realDrivesForbidden`) may not use these roots — one
 * is on a real drive — or `undefined`. Judged without touching the drive.
 */
const judgeRealDriveRoots = (
  env: Readonly<Record<string, string | undefined>>,
  roots: StorageRoots
): string | undefined => {
  if (!realDrivesForbidden(env)) return undefined;
  for (const root of roots) {
    const reached = realDriveReached(root);
    if (reached !== undefined) {
      return `Storage Root ${root} is on a real drive (${reached}), and this is an agent's server (a verify-cvm run, a cvm_verify_* database, or CVM_NO_REAL_DRIVES=1): it never reads Matt's drives. Give it a scratch directory of its own as STORAGE_ROOTS.`;
    }
  }
  return undefined;
};

/** A path with every symlink resolved; a path that does not exist yet, as is. */
const realpathOrResolved = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/**
 * Why a verify run's Storage Roots may not be used, or `undefined` when they
 * may (or when this is not a verify run).
 */
export const judgeVerifyRunContainment = (
  env: Readonly<Record<string, string | undefined>>,
  roots: StorageRoots,
  realpath: (path: string) => string = realpathOrResolved
): string | undefined => {
  const onDrive = judgeRealDriveRoots(env, roots);
  if (onDrive !== undefined) return onDrive;
  const runDir = env[VERIFY_RUN_DIR_ENV_KEY];
  if (runDir === undefined || runDir.trim() === "") return undefined;
  const realRunDir = realpath(runDir);
  const inside = (path: string) =>
    path === realRunDir || path.startsWith(realRunDir + sep);
  for (const root of roots) {
    for (const path of [
      root,
      ...Object.values(STORAGE_FOLDERS).map((f) => `${root}/${f}`),
    ]) {
      const real = realpath(path);
      if (!inside(real)) {
        return `${path} resolves to ${real}, outside this verify run's directory ${realRunDir} (${VERIFY_RUN_DIR_ENV_KEY}). A verify run must never reach a real Storage Root.`;
      }
    }
  }
  return undefined;
};

/** `STORAGE_ROOTS` as an Effect Config, parsed and validated. */
export const storageRootsConfig: Config.Config<StorageRoots> = Config.string(
  STORAGE_ROOTS_ENV_KEY
).pipe(
  Config.mapOrFail((raw) => {
    const parsed = Either.try({
      try: () => parseStorageRoots(raw),
      catch: (e) =>
        e instanceof InvalidStorageRootsError ? e.message : String(e),
    });
    return Either.mapLeft(parsed, (message) =>
      ConfigError.InvalidData([STORAGE_ROOTS_ENV_KEY], message)
    );
  })
);

/**
 * Where new Exported Videos are written: `finished-videos/` on the first
 * root. Reads look on every root (see `finished-videos.server.ts`).
 */
export const finishedVideosWriteDirectory: Effect.Effect<
  string,
  ConfigError.ConfigError
> = Effect.map(storageRootsConfig, (roots) =>
  writeFolder(roots, STORAGE_FOLDERS.finishedVideos)
);

/**
 * `STORAGE_ROOTS` for the synchronous readers (the Clip Mockup store, which
 * the `cvm` CLI reaches without an Effect runtime): an already-set
 * environment variable wins, otherwise the repo-root `.env`. Throws, naming
 * the variable, when it is unset or invalid.
 */
export const readStorageRootsSync = (): StorageRoots => {
  const raw = resolveRepoEnvValue(STORAGE_ROOTS_ENV_KEY);
  if (raw === undefined) {
    throw new InvalidStorageRootsError(
      `${STORAGE_ROOTS_ENV_KEY} is not set: add it to .env, e.g. ${STORAGE_ROOTS_ENV_KEY}=/mnt/d,/mnt/e`
    );
  }
  const roots = parseStorageRoots(raw);
  const refusal = judgeVerifyRunContainment(process.env, roots);
  if (refusal !== undefined) throw new InvalidStorageRootsError(refusal);
  return roots;
};

/**
 * The startup check on `STORAGE_ROOTS`, run by the app server and the Sidecar
 * before anything is built: `refusal` names the variable when it is missing
 * or invalid (the process must not start), and `offline` lists the roots that
 * are not there right now (an unplugged drive: a warning, not a refusal —
 * files on the other roots still work).
 */
export const judgeStorageRoots = (
  env: Readonly<Record<string, string | undefined>>,
  isDirectory: (root: string) => boolean,
  realpath: (path: string) => string = realpathOrResolved
): { refusal: string | undefined; offline: string[] } => {
  const raw = env[STORAGE_ROOTS_ENV_KEY];
  if (raw === undefined || raw.trim() === "") {
    return {
      refusal: `${STORAGE_ROOTS_ENV_KEY} is not set. Add it to .env — the drives CVM's files are on, in order, e.g. ${STORAGE_ROOTS_ENV_KEY}=/mnt/d (see .env.example and ADR 0040).`,
      offline: [],
    };
  }
  let roots: StorageRoots;
  try {
    roots = parseStorageRoots(raw);
  } catch (e) {
    return {
      refusal: e instanceof Error ? e.message : String(e),
      offline: [],
    };
  }
  const escaped = judgeVerifyRunContainment(env, roots, realpath);
  if (escaped !== undefined) return { refusal: escaped, offline: [] };
  return {
    refusal: undefined,
    offline: roots.filter((root) => !isDirectory(root)),
  };
};

const isDirectorySync = (root: string): boolean => {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
};

/**
 * {@link judgeStorageRoots} for the app server: throws on a refusal, so the
 * server does not start; warns, naming each offline root.
 */
export const assertStorageRoots = (
  env: Readonly<Record<string, string | undefined>>
): void => {
  const { refusal, offline } = judgeStorageRoots(env, isDirectorySync);
  if (refusal !== undefined) throw new InvalidStorageRootsError(refusal);
  for (const root of offline) {
    console.warn(
      `[storage] Storage Root ${root} is offline (not mounted or not a directory): files on it will be "not found" until it is back.`
    );
  }
};

/** {@link judgeStorageRoots} with the real filesystem, for the Sidecar. */
export const judgeStorageRootsOnDisk = (
  env: Readonly<Record<string, string | undefined>>
) => judgeStorageRoots(env, isDirectorySync);

/**
 * Export scratch: where exports are encoded before they reach
 * `finished-videos/` (`ffmpeg-encode-commands.ts`, `ffmpeg-encode-segments.ts`).
 * It is the OS temp folder, on no Storage Root, and a verify-cvm run shares it
 * with Matt's own app.
 */
export const exportScratchDirectory = (): string =>
  joinPath(tmpdir(), "video-processing");
