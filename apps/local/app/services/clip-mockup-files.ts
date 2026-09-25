import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Data, Effect } from "effect";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The per-Video Clip Mockup frame store.
 *
 * Frames live on disk at `{CLIP_MOCKUP_DIR}/{video.lineageId}/{relativePath}`
 * and the row carries only that relative path — so the CVM keeps its OWN copy
 * of every frame and an authoring agent clearing its scratch folder cannot
 * empty a Video's Animatic.
 *
 * DELIBERATELY NOT UNDER `VIDEO_FILES_DIR`. A Video File is Article Writer
 * context; sixty frames would drown the writer's context picker. Same
 * directory-is-the-state convention, different directory, on purpose.
 *
 * This module is the only thing that resolves a Clip Mockup path. It lives in
 * `apps/local` rather than `@cvm/core` because `@cvm/core` is deployed to a
 * box with no disk at all — the row half of the noun is over there, the file
 * half is here, and the CLI is what joins them.
 */

/** The environment variable naming the Clip Mockup directory. */
export const CLIP_MOCKUP_DIR_ENV_KEY = "CLIP_MOCKUP_DIR";

/** Raised when a caller-supplied path escapes the Video's frame directory. */
export class InvalidClipMockupPathError extends Data.TaggedError(
  "InvalidClipMockupPathError"
)<{
  readonly path: string;
  readonly message: string;
}> {}

/** Walk up from `start` until a directory containing package.json is found. */
function findRepoRoot(start: string): string | undefined {
  let dir = start;
  while (true) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The store's base directory: CLIP_MOCKUP_DIR when set (tests pin a temp dir
 * this way), otherwise `<repoRoot>/clip-mockups` anchored to THIS module's
 * install location.
 *
 * Deliberately NEVER cwd-relative, for the same reason `video-files.ts` says
 * so: the globally-linked `cvm` bin runs from arbitrary directories, and a
 * `./clip-mockups` fallback would scatter frames into whichever repo the agent
 * happened to be standing in. The machine gate, not this fallback, is what
 * actually decides whether the store is reachable.
 */
export function getClipMockupBaseDir(): string {
  const fromEnv = process.env[CLIP_MOCKUP_DIR_ENV_KEY];
  if (fromEnv != null && fromEnv !== "") {
    return fromEnv;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(moduleDir);
  if (repoRoot === undefined) {
    throw new Error(
      `Could not locate the course-video-manager repo root to resolve the Clip Mockup store; set ${CLIP_MOCKUP_DIR_ENV_KEY} explicitly.`
    );
  }
  return path.join(repoRoot, "clip-mockups");
}

/** A Video's own frame directory, or a path inside it. */
export function getClipMockupPath(
  lineageId: string,
  relativePath?: string
): string {
  const videoDir = path.join(getClipMockupBaseDir(), lineageId);
  return relativePath === undefined
    ? videoDir
    : path.join(videoDir, relativePath);
}

/**
 * Resolve a relative path inside a Video's frame directory, refusing anything
 * that escapes it or names the directory itself. Copied in shape from
 * `resolveVideoFilePath` — the containment guard is the part a caller must not
 * be able to forget.
 */
export function resolveClipMockupPath(
  lineageId: string,
  relativePath: string
): Effect.Effect<string, InvalidClipMockupPathError> {
  const root = path.resolve(getClipMockupPath(lineageId));

  if (relativePath.trim() === "") {
    return Effect.fail(
      new InvalidClipMockupPathError({
        path: relativePath,
        message: "path must not be empty",
      })
    );
  }

  if (path.isAbsolute(relativePath)) {
    return Effect.fail(
      new InvalidClipMockupPathError({
        path: relativePath,
        message: "path must be relative to the Clip Mockup directory",
      })
    );
  }

  const resolved = path.resolve(root, relativePath);

  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    return Effect.fail(
      new InvalidClipMockupPathError({
        path: relativePath,
        message: "path escapes the Clip Mockup directory",
      })
    );
  }

  return Effect.succeed(resolved);
}

/** Whether a frame already exists at `relativePath`. */
export const clipMockupFileExists = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const full = yield* resolveClipMockupPath(lineageId, relativePath);
    return yield* fs.exists(full);
  });

/** Read a stored frame or speech file back. */
export const readClipMockupFile = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const full = yield* resolveClipMockupPath(lineageId, relativePath);
    return yield* fs.readFile(full);
  });

/** Write a frame or a speech file, creating any missing parent directories. */
export const writeClipMockupFile = (
  lineageId: string,
  relativePath: string,
  content: Uint8Array
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const full = yield* resolveClipMockupPath(lineageId, relativePath);
    yield* fs.makeDirectory(path.dirname(full), { recursive: true });
    yield* fs.writeFile(full, content);
    return full;
  });

/**
 * Pick the name a newly-added frame is stored under.
 *
 * Content-addressed by a random id rather than the source basename: an
 * authoring agent regenerates `frame.png` in its scratch folder over and over,
 * and two Clip Mockups that happened to share a basename would otherwise
 * silently share one picture. The extension is kept so the file is still
 * openable by double-clicking it.
 */
export function newFrameFilename(sourcePath: string): string {
  const extension = path.extname(sourcePath).toLowerCase() || ".png";
  return `${crypto.randomUUID()}${extension}`;
}

/**
 * Copy the files a duplicated Video's Clip Mockups name out of the SOURCE
 * Video's directory and into the duplicate's own.
 *
 * A duplicate is a new Video with a new `lineageId`, but the rows copied onto
 * it keep `imagePath` and `audioPath` verbatim — so without this every frame
 * and every WAV resolves into an empty directory and the duplicate's Animatic
 * plays as sixty "frame missing" cards (#1669). The Draft Version snapshot
 * path never needed it: that copies `lineageId`, so both rows point at the
 * one directory, which is why an equal pair here is a no-op.
 *
 * The caller passes the paths the COPIED rows name, which is what keeps an
 * archived Clip Mockup's frame out of it: an archived row is never copied, so
 * its files are never asked for. A path the source directory does not have is
 * skipped rather than failing the duplicate — the row was already broken, and
 * the Animatic page reports it as missing on both Videos alike.
 */
export const copyClipMockupFiles = (
  sourceLineageId: string,
  targetLineageId: string,
  relativePaths: readonly string[]
): Effect.Effect<
  number,
  InvalidClipMockupPathError | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (sourceLineageId === targetLineageId) return 0;

    const fs = yield* FileSystem.FileSystem;
    let copied = 0;

    // De-duplicated: two Clip Mockups saying the same words share one WAV.
    for (const relativePath of new Set(relativePaths)) {
      const from = yield* resolveClipMockupPath(sourceLineageId, relativePath);
      const to = yield* resolveClipMockupPath(targetLineageId, relativePath);

      if (!(yield* fs.exists(from))) continue;

      yield* fs.makeDirectory(path.dirname(to), { recursive: true });
      yield* fs.copyFile(from, to);
      copied++;
    }

    return copied;
  });
