import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Data, Effect } from "effect";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The per-Video scratch file store.
 *
 * Files live on disk at `{VIDEO_FILES_DIR}/{video.lineageId}/{relativePath}`
 * and are NOT rows in any table — the directory listing IS the state. They are
 * fed to the Article Writer as context alongside the derived Transcript.
 *
 * Everything that touches the store should go through this module: the walk,
 * the containment guard, and the read/write/delete helpers all live here so
 * callers cannot forget one (they historically did — four copies of a
 * non-recursive readdir, one traversal guard between seven routes).
 */

/** Extensions that are ticked by default in the writer's context picker. */
export const DEFAULT_CHECKED_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "md",
  "mdx",
  "txt",
  "csv",
];

/** Directory names the walk never descends into. */
export const ALWAYS_EXCLUDED_DIRECTORIES = ["node_modules", ".vite"];

export interface VideoFileEntry {
  /** Path relative to the video's directory, POSIX-separated, e.g. "notes/snippet.md". */
  readonly path: string;
  readonly size: number;
  readonly defaultEnabled: boolean;
}

/** Raised when a caller-supplied path escapes the video's directory. */
export class InvalidVideoFilePathError extends Data.TaggedError(
  "InvalidVideoFilePathError"
)<{
  readonly path: string;
  readonly message: string;
}> {}

/** Walk up from `start` until a directory containing package.json is found. */
function findRepoRoot(start: string): string | undefined {
  let dir = start;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The store's base directory: VIDEO_FILES_DIR when set (tests pin a temp dir
 * this way), otherwise `<repoRoot>/video-files` anchored to THIS module's
 * install location — the same trick `app/cli/env.ts` uses for DATABASE_URL.
 *
 * Deliberately NEVER cwd-relative: the globally-linked `cvm` bin runs from
 * arbitrary directories, and a `./video-files` fallback once scattered files
 * into whichever repo the agent happened to be in, invisibly to the server.
 */
export function getVideoFilesBaseDir(): string {
  const fromEnv = process.env.VIDEO_FILES_DIR;
  if (fromEnv != null && fromEnv !== "") {
    return fromEnv;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(moduleDir);
  if (repoRoot === undefined) {
    throw new Error(
      "Could not locate the course-video-manager repo root to resolve the video file store; set VIDEO_FILES_DIR explicitly."
    );
  }
  return path.join(repoRoot, "video-files");
}

export function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

export function getVideoFilePath(lineageId: string, filename?: string): string {
  const baseDir = getVideoFilesBaseDir();
  const videoDir = path.join(baseDir, lineageId);

  if (filename) {
    if (isUrl(filename)) {
      return filename;
    }
    return path.join(videoDir, filename);
  }

  return videoDir;
}

/**
 * Whether a file is ticked by default in the writer's context picker.
 * Keyed off the basename, so `notes/snippet.md` behaves like `snippet.md`.
 */
export function isDefaultEnabled(relativePath: string): boolean {
  const extension = path.extname(path.basename(relativePath)).slice(1);
  return DEFAULT_CHECKED_EXTENSIONS.includes(extension);
}

/**
 * Resolve a caller-supplied relative path inside a video's directory,
 * refusing anything that escapes it or names the directory itself.
 */
export function resolveVideoFilePath(
  lineageId: string,
  relativePath: string
): Effect.Effect<string, InvalidVideoFilePathError> {
  const root = path.resolve(getVideoFilePath(lineageId));

  if (relativePath.trim() === "") {
    return Effect.fail(
      new InvalidVideoFilePathError({
        path: relativePath,
        message: "path must not be empty",
      })
    );
  }

  if (path.isAbsolute(relativePath)) {
    return Effect.fail(
      new InvalidVideoFilePathError({
        path: relativePath,
        message: "path must be relative to the video's file directory",
      })
    );
  }

  const resolved = path.resolve(root, relativePath);

  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    return Effect.fail(
      new InvalidVideoFilePathError({
        path: relativePath,
        message: "path escapes the video's file directory",
      })
    );
  }

  return Effect.succeed(resolved);
}

const toRelative = (prefix: string, name: string) =>
  prefix === "" ? name : `${prefix}/${name}`;

const walkDirectory = (
  fs: FileSystem.FileSystem,
  root: string,
  prefix: string
): Effect.Effect<Array<VideoFileEntry>, PlatformError> =>
  Effect.gen(function* () {
    const directory = prefix === "" ? root : path.join(root, prefix);
    const names = yield* fs.readDirectory(directory);

    const nested = yield* Effect.forEach(names, (name) =>
      Effect.gen(function* () {
        // Dotfiles are tooling noise (.DS_Store, .git), never writer context.
        if (name.startsWith(".")) {
          return [] as Array<VideoFileEntry>;
        }

        const relativePath = toRelative(prefix, name);
        const stat = yield* fs.stat(path.join(root, relativePath));

        if (stat.type === "Directory") {
          if (ALWAYS_EXCLUDED_DIRECTORIES.includes(name)) {
            return [] as Array<VideoFileEntry>;
          }
          return yield* walkDirectory(fs, root, relativePath);
        }

        if (stat.type !== "File") {
          return [] as Array<VideoFileEntry>;
        }

        return [
          {
            path: relativePath,
            size: Number(stat.size),
            defaultEnabled: isDefaultEnabled(relativePath),
          },
        ];
      })
    );

    return nested.flat();
  });

/**
 * Every file under a video's directory, recursively, sorted by path.
 * Returns `[]` when the directory does not exist.
 */
export const listVideoFiles = (
  lineageId: string
): Effect.Effect<Array<VideoFileEntry>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = getVideoFilePath(lineageId);

    if (!(yield* fs.exists(root))) {
      return [];
    }

    const entries = yield* walkDirectory(fs, root, "");
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  });

export const videoFileExists = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = yield* resolveVideoFilePath(lineageId, relativePath);
    return yield* fs.exists(filePath);
  });

export const readVideoFileString = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = yield* resolveVideoFilePath(lineageId, relativePath);
    return yield* fs.readFileString(filePath);
  });

export const readVideoFile = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = yield* resolveVideoFilePath(lineageId, relativePath);
    return yield* fs.readFile(filePath);
  });

/** Write a file, creating any missing parent directories. */
export const writeVideoFile = (
  lineageId: string,
  relativePath: string,
  content: string | Uint8Array
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = yield* resolveVideoFilePath(lineageId, relativePath);

    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });

    if (typeof content === "string") {
      yield* fs.writeFileString(filePath, content);
    } else {
      yield* fs.writeFile(filePath, content);
    }

    return filePath;
  });

/** Remove a file. Empty parent directories are left in place. */
export const deleteVideoFile = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = yield* resolveVideoFilePath(lineageId, relativePath);
    yield* fs.remove(filePath);
  });

/**
 * Carry a duplicated Video's Video Files across, and say how many landed.
 *
 * A duplicate is a NEW Video with a fresh `lineageId` — the column has
 * `$defaultFn(crypto.randomUUID)` and neither `copyVideo` nor `duplicateCourse`
 * carries the source's forward — so `{VIDEO_FILES_DIR}/{lineageId}/` is a
 * directory that does not exist yet. Nothing in the database points at the
 * store (the directory listing IS the state), so nothing breaks loudly: the
 * copy's writer context is simply empty, and its Thumbnail images are gone
 * with it (#1674).
 *
 * The whole directory moves, not a named list of files, because that listing
 * is the only record of what a Video's files are — and copying it whole is
 * also what puts a duplicated Thumbnail's PNG under the path
 * `rebaseThumbnailPaths` rewrote it to.
 *
 * Lives here rather than in `@cvm/core` for the reason the module header
 * gives: core is deployed to a box with no disk, so the file half of every
 * duplicate belongs at the call site in `apps/local`.
 *
 * A source directory that does not exist is not an error — a Video with no
 * Video Files is ordinary — and an equal pair is a no-op, which is what keeps
 * the Draft Version snapshot path (it copies `lineageId`) out of this.
 */
export const copyVideoFilesDirectory = (
  sourceLineageId: string,
  targetLineageId: string
): Effect.Effect<number, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (sourceLineageId === targetLineageId) return 0;

    const fs = yield* FileSystem.FileSystem;
    const from = getVideoFilePath(sourceLineageId);

    if (!(yield* fs.exists(from))) return 0;

    const entries = yield* listVideoFiles(sourceLineageId);
    if (entries.length === 0) return 0;

    yield* fs.copy(from, getVideoFilePath(targetLineageId));

    return entries.length;
  });
