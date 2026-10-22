import { FileSystem } from "@effect/platform";
import { assertUnderEffect, isUnder } from "./assert-under";
import type { PlatformError } from "@effect/platform/Error";
import { Data, Effect, Option } from "effect";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  folderOnEveryRoot,
  rootRelativePath,
  STORAGE_FOLDERS,
  writeFolder,
} from "@/packages/storage";
import {
  existsOnStorage,
  findStoragePathSync,
} from "@/packages/storage/server";
import { removeUnderBestEffort } from "./remove-best-effort";
import { installLocationRepoRoot } from "./repo-env";
import { readStorageRootsSync } from "./storage-roots";

/**
 * The per-Video scratch file store.
 *
 * Files live on disk at `video-files/{video.lineageId}/{relativePath}` on a
 * Storage Root (ADR 0040): written to the first root, read from the first
 * store that has them. They are NOT rows in any table — the directory listing
 * IS the state. They are fed to the Article Writer as context alongside the
 * derived Transcript. The one row that names a Video File is a Thumbnail's,
 * and it stores the path relative to its Storage Root
 * ({@link videoFileRowPath}).
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
function findPackageRoot(start: string): string | undefined {
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
 * Where new Video Files are written: `video-files/` on the first Storage
 * Root (ADR 0040). Reads look in every store ({@link videoFilesStores}).
 * Throws, naming `STORAGE_ROOTS`, when that setting is missing.
 */
export function getVideoFilesBaseDir(): string {
  return writeFolder(readStorageRootsSync(), STORAGE_FOLDERS.videoFiles);
}

/**
 * Where Video Files were before they had a Storage Root (#2105): read and
 * deleted from, never written to, until the one-off relocation
 * (`pnpm storage:relocate`) empties them.
 *
 * `VIDEO_FILES_DIR` when set; otherwise the in-checkout stores this module's
 * install location has had — `apps/local/video-files` (since the
 * `apps/local` split) and the workspace root's `video-files` (before it).
 * Anchored to THIS module, never to cwd: the globally-linked `cvm` bin runs
 * from arbitrary directories.
 */
export function legacyVideoFilesStores(): string[] {
  const fromEnv = process.env.VIDEO_FILES_DIR;
  if (fromEnv != null && fromEnv !== "") return [fromEnv];
  const appRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
  if (appRoot === undefined) return [];
  const stores = [path.join(appRoot, "video-files")];
  const workspaceRoot = installLocationRepoRoot();
  if (workspaceRoot !== undefined && workspaceRoot !== appRoot) {
    stores.push(path.join(workspaceRoot, "video-files"));
  }
  return stores;
}

/**
 * Every Video Files store, in lookup order: `video-files/` on each Storage
 * Root (the first is where new files go), then the legacy stores. A file is
 * read from the first store that has it.
 */
export function videoFilesStores(): string[] {
  const roots = readStorageRootsSync();
  const stores = [
    ...folderOnEveryRoot(roots, STORAGE_FOLDERS.videoFiles),
    ...legacyVideoFilesStores(),
  ].map((store) => path.resolve(store));
  return [...new Set(stores)];
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

  // The lexical check above names the error a caller sees for `..`; this
  // one also follows symlinks, so a link inside the store cannot lead out.
  if (!isUnder(root, resolved)) {
    return Effect.fail(
      new InvalidVideoFilePathError({
        path: relativePath,
        message: "path escapes the video's file directory through a symlink",
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

/** Every store's directory for one Video, in lookup order. */
const videoDirectories = (lineageId: string) =>
  videoFilesStores().map((store) => path.join(store, lineageId));

/**
 * The one folder that stands for a Video's files where a single folder is
 * needed (open it in Explorer, resolve a Markdown body's relative images):
 * the first store that has the Video's directory, else where its files will
 * be written.
 */
export function videoFilesDirectory(lineageId: string): string {
  return (
    videoDirectories(lineageId).find((dir) => existsSync(dir)) ??
    getVideoFilePath(lineageId)
  );
}

/**
 * Every file under a video's directory, recursively, sorted by path — across
 * every store, the first store that has a path winning. Returns `[]` when no
 * store has the directory.
 */
export const listVideoFiles = (
  lineageId: string
): Effect.Effect<Array<VideoFileEntry>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const byPath = new Map<string, VideoFileEntry>();
    const roots = readStorageRootsSync();
    for (const dir of videoDirectories(lineageId)) {
      // A store on an Offline Storage Root has no files until it is back.
      if (!(yield* existsOnStorage(dir, roots))) continue;
      for (const entry of yield* walkDirectory(fs, dir, "")) {
        if (!byPath.has(entry.path)) byPath.set(entry.path, entry);
      }
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  });

/**
 * Where a Video File is on disk: the first store that has it, or None. The
 * path is checked against the Video's directory first, as for a write.
 */
export const locateVideoFile = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    yield* resolveVideoFilePath(lineageId, relativePath);
    const roots = readStorageRootsSync();
    for (const dir of videoDirectories(lineageId)) {
      const candidate = yield* assertUnderEffect(
        dir,
        path.join(dir, relativePath)
      ).pipe(Effect.option);
      if (Option.isNone(candidate)) continue;
      if (yield* existsOnStorage(candidate.value, roots)) return candidate;
    }
    return Option.none<string>();
  });

/** Where to read a Video File: where it is, else where it would be written. */
const readPath = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const found = yield* locateVideoFile(lineageId, relativePath);
    return Option.isSome(found)
      ? found.value
      : yield* resolveVideoFilePath(lineageId, relativePath);
  });

export const videoFileExists = (lineageId: string, relativePath: string) =>
  Effect.map(locateVideoFile(lineageId, relativePath), Option.isSome);

export const readVideoFileString = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(yield* readPath(lineageId, relativePath));
  });

export const readVideoFile = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFile(yield* readPath(lineageId, relativePath));
  });

/**
 * Every copy of a Video File other than `keep`, in any store. Two copies
 * (a legacy one, or one left on another drive) would leave the older one
 * shadowed, so a write or a delete removes them.
 */
const removeOtherCopies = (
  lineageId: string,
  relativePath: string,
  keep: string | null
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const dir of videoDirectories(lineageId)) {
      const candidate = path.join(dir, relativePath);
      if (candidate === keep) continue;
      if (!(yield* fs.exists(candidate))) continue;
      yield* removeUnderBestEffort(fs, dir, candidate);
    }
  });

/**
 * Write a file on the first Storage Root, creating any missing parent
 * directories, and remove any older copy of it in another store.
 */
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

    yield* removeOtherCopies(lineageId, relativePath, filePath);
    return filePath;
  });

/**
 * Remove a file from every store that has it. Empty parent directories are
 * left in place. Fails, as a plain remove does, when no store has it.
 */
export const deleteVideoFile = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* resolveVideoFilePath(lineageId, relativePath);
    for (const dir of videoDirectories(lineageId)) {
      const target = yield* assertUnderEffect(
        dir,
        path.join(dir, relativePath)
      );
      if (!(yield* fs.exists(target))) continue;
      // The first copy is removed for real (its failure is the caller's);
      // any other is best-effort.
      yield* fs.remove(target);
      yield* removeOtherCopies(lineageId, relativePath, target);
      return;
    }
    const nowhere = yield* resolveVideoFilePath(lineageId, relativePath);
    yield* fs.remove(nowhere);
  });

/**
 * The path a row stores for a Video File: relative to its Storage Root
 * (`video-files/{lineageId}/{relativePath}`), with no drive in it, so the
 * file can move between drives without the row changing.
 */
export function videoFileRowPath(
  lineageId: string,
  relativePath: string
): string {
  return path.posix.join(STORAGE_FOLDERS.videoFiles, lineageId, relativePath);
}

/**
 * The file a stored Video File path (a Thumbnail's) names, relative to the
 * Video's own directory — or null when the path is in no Video Files store,
 * or not in this Video's directory there (a verify-cvm clone's row naming
 * Matt's real file, a broken `.worktrees` path).
 */
export function videoFileRelativePathOf(
  stored: string,
  lineageId: string
): string | null {
  const roots = readStorageRootsSync();
  const relative = rootRelativePath(stored, roots);
  const inVideoDir = (dir: string, file: string) => {
    const rel = path.relative(dir, file);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
      ? rel.split(path.sep).join("/")
      : null;
  };
  if (relative !== null) {
    return inVideoDir(
      path.posix.join(STORAGE_FOLDERS.videoFiles, lineageId),
      relative
    );
  }
  for (const store of legacyVideoFilesStores()) {
    const rel = inVideoDir(
      path.join(path.resolve(store), lineageId),
      path.resolve(stored)
    );
    if (rel !== null) return rel;
  }
  return null;
}

/**
 * Where a stored Video File path (a Thumbnail's) is on disk: a root-relative
 * path on the first Storage Root that has it (or, for an old checkout-relative
 * row, the legacy store that has it), a legacy absolute path as it is. Null
 * when the file is in none of them.
 */
export function locateStoredVideoFile(stored: string): string | null {
  const found = findStoragePathSync(stored, readStorageRootsSync());
  if (found !== null) return found;
  // Old rows stored `video-files/{lineageId}/…` relative to the checkout:
  // until the relocation moves those files, they are in a legacy store.
  const prefix = `${STORAGE_FOLDERS.videoFiles}/`;
  if (path.isAbsolute(stored) || !stored.startsWith(prefix)) return null;
  for (const store of legacyVideoFilesStores()) {
    const candidate = path.join(store, stored.slice(prefix.length));
    if (isUnder(store, candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Remove every copy of the file a stored Video File path names. Only files in
 * a Video Files store are ever removed: on a verify-cvm clone a row still
 * names Matt's real file, which is in no store of the clone's.
 */
export const removeStoredVideoFile = (
  fs: FileSystem.FileSystem,
  stored: string
) =>
  Effect.gen(function* () {
    const roots = readStorageRootsSync();
    const relative = rootRelativePath(stored, roots);
    if (relative !== null) {
      for (const root of roots) {
        yield* removeUnderBestEffort(
          fs,
          path.join(root, STORAGE_FOLDERS.videoFiles),
          path.join(root, relative)
        );
      }
      // An old checkout-relative row's file may still be in a legacy store.
      const prefix = `${STORAGE_FOLDERS.videoFiles}/`;
      if (path.isAbsolute(stored) || !relative.startsWith(prefix)) return;
      for (const store of legacyVideoFilesStores()) {
        const candidate = path.join(store, relative.slice(prefix.length));
        if (yield* fs.exists(candidate)) {
          yield* removeUnderBestEffort(fs, store, candidate);
        }
      }
      return;
    }
    for (const store of legacyVideoFilesStores()) {
      if (isUnder(store, stored)) {
        yield* removeUnderBestEffort(fs, store, stored);
      }
    }
  });

/**
 * Carry a duplicated Video's Video Files across, and say how many landed.
 *
 * A duplicate is a NEW Video with a fresh `lineageId` — the column has
 * `$defaultFn(crypto.randomUUID)` and neither `copyVideo` nor `duplicateCourse`
 * carries the source's forward — so `video-files/{lineageId}/` is a
 * directory that does not exist yet. Nothing in the database points at the
 * store (the directory listing IS the state), so nothing breaks loudly: the
 * copy's writer context is simply empty, and its Thumbnail images are gone
 * with it (#1674).
 *
 * Every file under the source's directory moves, not a named list, because
 * that listing is the only record of what a Video's files are — and copying
 * it whole is also what puts a duplicated Thumbnail's PNG under the path
 * `rebaseThumbnailPaths` rewrote it to. Each file is read from whichever
 * store has it and written to the first Storage Root.
 *
 * The single-Video copy (`api.videos.$videoId.copy.ts`) uses this. A Course
 * duplicate copies its Videos' files one by one, resumably and checked, in
 * the `duplicate-course` Job (`course-duplicate-files.ts`).
 *
 * Lives here rather than in `@cvm/core` for the reason the module header
 * gives: core is deployed to a box with no disk, so the file half of every
 * duplicate belongs at the call site in `apps/local`.
 *
 * A source with no files is not an error — a Video with no Video Files is
 * ordinary — and an equal pair is a no-op, which is what keeps the Draft
 * Version snapshot path (it copies `lineageId`) out of this.
 */
export const copyVideoFilesDirectory = (
  sourceLineageId: string,
  targetLineageId: string
) =>
  Effect.gen(function* () {
    if (sourceLineageId === targetLineageId) return 0;

    const fs = yield* FileSystem.FileSystem;
    const entries = yield* listVideoFiles(sourceLineageId);

    for (const entry of entries) {
      const from = yield* locateVideoFile(sourceLineageId, entry.path);
      if (Option.isNone(from)) continue;
      const to = yield* resolveVideoFilePath(targetLineageId, entry.path);
      yield* fs.makeDirectory(path.dirname(to), { recursive: true });
      yield* fs.copyFile(from.value, to);
    }

    return entries.length;
  });
