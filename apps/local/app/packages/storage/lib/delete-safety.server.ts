import nodeFs from "node:fs/promises";
import path from "node:path";
import { and, inArray, ne } from "drizzle-orm";
import { Data } from "effect";
import { jobs } from "@cvm/core/db/schema";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { assertUnder } from "@/services/assert-under";
import { STORAGE_FOLDERS, type StorageRoots } from "./storage-roots";

/**
 * The author's Cancel stopped a delete Job before its next file. What went
 * stays gone; every other file is where it was.
 */
export class StorageDeleteCancelledError extends Data.TaggedError(
  "StorageDeleteCancelledError"
)<{ readonly message: string }> {}

/** Thrown inside a delete's loop when Cancel was asked for. */
export class DeleteStopRequested extends Error {}

/** Stop before the next file when the author asked to Cancel. */
export const stopIfCancelled = (cancelRequested?: () => boolean) => {
  if (cancelRequested?.()) throw new DeleteStopRequested("Cancelled");
};

/** A delete loop's failure: the author's Cancel, or `otherwise`. */
export const cancelledOr = <E>(cause: unknown, otherwise: () => E) =>
  cause instanceof DeleteStopRequested
    ? new StorageDeleteCancelledError({
        message:
          "Cancelled before the next file: what was deleted stays deleted, every other file is where it was",
      })
    : otherwise();

/**
 * The checks every Storage page delete makes before it unlinks a file
 * (#2112's Other buckets, #2111's Purge of Exported Videos). A file is
 * deleted only when it is a regular file (never a link), its real path is
 * strictly inside its bucket's real folder, and it is under no root's
 * `raw-footage/`. A folder that is not really where it is named is left
 * whole. Raw Footage is never deleted (ADR 0041).
 */

/**
 * The Job kinds that encode: each writes export scratch, and the export and
 * the vertical render read (and write) the Overlay Render Cache and write
 * `finished-videos/`. A Publish exports its Videos.
 */
export const ENCODING_JOB_KINDS = [
  "export",
  "export-animatic",
  "batch-export",
  "render-vertical",
  "publish",
] as const;

/**
 * What a Storage page delete waits for: every encoding Job, and a move of a
 * Storage Bucket (#2109), which copies from the very folders a delete empties.
 */
export const STORAGE_BUSY_JOB_KINDS = [
  ...ENCODING_JOB_KINDS,
  "storage-move",
  // A delete Job (#2157): never two deletes, or a delete and a move, at once.
  "storage-delete",
] as const;

/**
 * Every encoding Job, Storage move or delete Job that is queued or running,
 * other than `selfJobId` (the delete Job asking).
 */
export const encodingJobs = (db: Database, selfJobId?: string | null) =>
  db
    .select({ kind: jobs.kind, title: jobs.title })
    .from(jobs)
    .where(
      and(
        inArray(jobs.kind, [...STORAGE_BUSY_JOB_KINDS]),
        inArray(jobs.status, ["queued", "running"]),
        selfJobId ? ne(jobs.id, selfJobId) : undefined
      )
    );

/** "Not deleted: an export is queued or running (…)". */
export const encodingRefusalMessage = (
  encoding: readonly { kind: string; title: string }[]
) => {
  const kind = encoding[0]!.kind;
  const what =
    kind === "storage-move"
      ? "a move"
      : kind === "storage-delete"
        ? "a delete"
        : "an export";
  return `Not deleted: ${encoding.length === 1 ? `${what} is` : `${encoding.length} exports, moves or deletes are`} queued or running (${encoding[0]!.title}). Try again once it has finished.`;
};

/** "Not deleted: a move is being started…": the in-process write hold. */
export const storageBusyMessage = (heldBy: string) =>
  `Not deleted: ${heldBy} is under way on the Storage page. Try again in a moment.`;

export const messageOf = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e !== null && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

export const isInside = (base: string, target: string) => {
  const relative = path.relative(base, target);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

export const isAtOrInside = (base: string, target: string) =>
  base === target || isInside(base, target);

export const realpathOrNull = async (p: string) => {
  try {
    return await nodeFs.realpath(p);
  } catch {
    return null;
  }
};

/** Every regular file under `dir` (symlinks are listed, never followed). */
export const listFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const entries = await nodeFs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
};

/** Empty folders left under `dir` once its files are gone; `dir` itself stays. */
export const removeEmptyFolders = async (dir: string) => {
  const entries = await nodeFs
    .readdir(dir, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    await removeEmptyFolders(sub);
    // rmdir only ever removes an EMPTY folder.
    await nodeFs.rmdir(sub).catch(() => undefined);
  }
};

/**
 * One place a bucket's files are: a folder, and what it must really be on
 * disk. `realFolder` is checked before anything in it is touched.
 */
export type DeleteLocation = {
  /** Where the file is reported as being (a Storage Root, or export scratch). */
  readonly location: string;
  /** The folder walked. */
  readonly folder: string;
  /** Root-relative paths are classified against this root; null for scratch. */
  readonly root: string | null;
};

/** The real paths of the roots, and of every root's `raw-footage/`. */
export const realRootsAndFootage = async (roots: StorageRoots) => {
  const realRoots = (await Promise.all(roots.map(realpathOrNull))).filter(
    (r): r is string => r !== null
  );
  const realFootageFolders = (
    await Promise.all(
      roots.map((r) => realpathOrNull(path.join(r, STORAGE_FOLDERS.rawFootage)))
    )
  ).filter((r): r is string => r !== null);
  return { realRoots, realFootageFolders };
};

/** The real path of a verify-cvm run's own directory, or null outside one. */
export const realConfineOf = async (confineTo: string | undefined) =>
  confineTo === undefined
    ? null
    : ((await realpathOrNull(confineTo)) ?? confineTo);

/** An Exported Video or its companion (`x.mp4`, `x.mp4.sha256`). */
export const looksLikeAnExport = (name: string) =>
  !name.startsWith(".") && /\.mp4(\..+)?$/.test(name);

/**
 * Why the bucket's folder at `at` must not be touched at all, or null. It must
 * really be where it is named: `<root>/overlay-renders` itself, not a link to
 * `raw-footage/` or anywhere else; export scratch must hold no Storage Root
 * and be on none. With `realConfine` (a verify-cvm run's own directory) it
 * must be inside that too.
 */
export const folderRefusal = async (
  at: DeleteLocation,
  realRoots: readonly string[],
  realConfine: string | null
): Promise<string | null> => {
  const realFolder = await realpathOrNull(at.folder);
  if (realFolder === null) return "it can't be resolved";
  if (realConfine !== null && !isAtOrInside(realConfine, realFolder)) {
    return `${realFolder} is outside ${realConfine}, the only place this run may delete`;
  }
  if (at.root === null) {
    if (realRoots.some((r) => isAtOrInside(r, realFolder))) {
      return `export scratch ${realFolder} is on a Storage Root`;
    }
    if (realRoots.some((r) => isAtOrInside(realFolder, r))) {
      return `export scratch ${realFolder} holds a Storage Root`;
    }
    return null;
  }
  const realRoot = await realpathOrNull(at.root);
  const expected =
    realRoot === null
      ? null
      : path.join(realRoot, path.relative(at.root, at.folder));
  return realFolder === expected
    ? null
    : `${at.folder} really is ${realFolder}, not ${expected}`;
};

/**
 * Why the file at `file` must not be deleted, or null when it may. It must be
 * a regular file, not a link; its real path (every symlink followed) must be
 * strictly inside the bucket's real folder and under no root's
 * `raw-footage/`, whatever else holds; and with `exportsOnly` it must be named
 * as an Exported Video or its companion (`x.mp4`, `x.mp4.sha256`).
 */
export const fileRefusal = async (opts: {
  readonly at: DeleteLocation;
  readonly file: string;
  readonly realFootageFolders: readonly string[];
  readonly exportsOnly: boolean;
}): Promise<string | null> => {
  const { at, file } = opts;
  const info = await nodeFs.lstat(file).catch(() => null);
  if (info === null) return "it is gone";
  if (!info.isFile()) return "it is not a regular file (a link?)";
  try {
    assertUnder(at.folder, file);
  } catch (error) {
    return messageOf(error);
  }
  const realFolder = await realpathOrNull(at.folder);
  const realFile = await realpathOrNull(file);
  if (realFolder === null || realFile === null) return "it can't be resolved";
  if (!isInside(realFolder, realFile)) {
    return `it really is ${realFile}, outside ${realFolder}`;
  }
  if (opts.realFootageFolders.some((f) => isAtOrInside(f, realFile))) {
    return `it really is ${realFile}, raw Footage, which is never deleted`;
  }
  if (opts.exportsOnly && !looksLikeAnExport(path.basename(file))) {
    return "it is not an Exported Video or its companion";
  }
  return null;
};
