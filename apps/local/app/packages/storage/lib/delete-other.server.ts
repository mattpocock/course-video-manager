import nodeFs from "node:fs/promises";
import path from "node:path";
import { holdingStorageWrites } from "./storage-busy";
import { Data, Effect } from "effect";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { EXPORT_HASH_RENAME_MARKER } from "@/services/export-hash-rename";
import {
  classifyStorageFile,
  EXPORT_SCRATCH_BUCKET,
  ORPHANED_EXPORTS_BUCKET,
  OVERLAY_RENDER_CACHE_BUCKET,
  UNUSED_IMPORTED_FOOTAGE_BUCKET,
  type StorageOwnership,
} from "./buckets";
import {
  cancelledOr,
  encodingJobs,
  stopIfCancelled,
  type StorageDeleteCancelledError,
  encodingRefusalMessage,
  storageBusyMessage,
  fileRefusal,
  folderRefusal,
  listFiles,
  messageOf,
  realConfineOf,
  realRootsAndFootage,
  removeEmptyFolders,
  type DeleteLocation,
} from "./delete-safety.server";
import { loadStorageOwnership } from "./ownership.server";
import {
  DELETABLE_STORAGE_BUCKETS,
  type DeletableStorageBucketId,
  type StorageDeleteResult,
} from "./scan-wire";
import {
  STORAGE_FOLDERS,
  writeFolder,
  type StorageFolder,
  type StorageRoots,
} from "./storage-roots";

/**
 * Why a Storage Bucket's files were not deleted. Nothing was deleted.
 *
 * - `not-deletable`: only the Overlay Render Cache, export scratch and
 *   Exported Videos of no current Video can be deleted here. Footage of any
 *   kind, Clip Mockups and a Course's, Standalone Videos' or Shorts' buckets
 *   never can be (ADR 0041); Unused Footage has its own delete
 *   (`./unused-delete.server.ts`).
 * - `export-running`: an export, a vertical render or a Publish is queued or
 *   running; it writes export scratch, reads Overlay renders and writes into
 *   `finished-videos/`.
 * - `exports-not-renamed`: the one-off rename of Exported Videos to their
 *   root-relative Export Hash (#2104) has not been recorded. Until it has,
 *   every Exported Video is named by a hash no Video computes, so every one
 *   would look orphaned.
 */
export class StorageDeleteRefusedError extends Data.TaggedError(
  "StorageDeleteRefusedError"
)<{
  readonly bucketId: string;
  readonly reason:
    "not-deletable" | "export-running" | "exports-not-renamed" | "storage-busy";
  readonly message: string;
}> {}

/** Reading the roots or the database failed before anything was deleted. */
export class StorageDeleteFailedError extends Data.TaggedError(
  "StorageDeleteFailedError"
)<{ readonly bucketId: string; readonly message: string }> {}

type Location = DeleteLocation;

const locationsOf = (
  bucketId: DeletableStorageBucketId,
  roots: StorageRoots,
  scratchDir: string
): Location[] => {
  if (bucketId === EXPORT_SCRATCH_BUCKET.id) {
    return [{ location: scratchDir, folder: scratchDir, root: null }];
  }
  const folder: StorageFolder =
    bucketId === OVERLAY_RENDER_CACHE_BUCKET.id
      ? STORAGE_FOLDERS.overlayRenders
      : STORAGE_FOLDERS.finishedVideos;
  return roots.map((root) => ({
    location: root,
    folder: path.join(root, folder),
    root,
  }));
};

/**
 * Whether the database says the file at `file` is this bucket's. Everything
 * in export scratch is; on a root, it is classified exactly as the scan
 * classifies it, from ownership read fresh for this delete.
 */
const inBucket = (
  bucketId: DeletableStorageBucketId,
  at: Location,
  file: string,
  ownership: StorageOwnership
) => {
  if (at.root === null) return true;
  const relative = path.relative(at.root, file).split(path.sep).join("/");
  return classifyStorageFile(ownership, relative)?.bucketId === bucketId;
};

/**
 * Delete every file of one deletable Other Storage Bucket, on every root:
 * the Overlay Render Cache (re-rendered on demand), export scratch, or the
 * Exported Videos of no current Video (#1493's standalone orphans and
 * legacy flat files of deleted Videos included).
 *
 * Every other bucket is refused outright: raw Footage is never deleted here
 * (Unused Footage has its own delete, `./unused-delete.server.ts`), and Clip Mockups are only
 * viewed and moved (ADR 0041). What owns each file is read fresh from the database here, never
 * taken from the page. Each file is checked on disk first (`refusalFor`);
 * one that fails the check, or that Windows won't let go of, is left and
 * reported, and the rest still go.
 */
export const deleteOtherStorageBucket = (opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly bucketId: string;
  /** Where exports are encoded before they reach `finished-videos/`. */
  readonly scratchDir: string;
  /**
   * Delete nothing outside this folder (a verify-cvm run's own directory):
   * its export scratch is the OS temp folder Matt's own app encodes in.
   */
  readonly confineTo?: string;
  /**
   * Keep the delete to these files (`path` relative to `location`, as the
   * per-bucket page lists them); absent, the whole bucket. Each must still be
   * the bucket's.
   */
  readonly files?: readonly { location: string; path: string }[];
  /** Delete nothing; answer what would go (the confirmation). */
  readonly dryRun?: boolean;
  /** The delete Job doing this: not a reason for it to refuse itself. */
  readonly selfJobId?: string | null;
  /** Called after each file, deleted or not. */
  readonly onProgress?: (done: number, total: number) => void;
  /** The author's Cancel: stop before the next file. */
  readonly cancelRequested?: () => boolean;
  /** The caller holds the Storage page's write hold already (a start). */
  readonly alreadyHeld?: boolean;
}): Effect.Effect<
  StorageDeleteResult,
  | StorageDeleteRefusedError
  | StorageDeleteFailedError
  | StorageDeleteCancelledError
> =>
  Effect.gen(function* () {
    const bucketId = DELETABLE_STORAGE_BUCKETS.find(
      (id) => id === opts.bucketId
    );
    if (opts.bucketId === UNUSED_IMPORTED_FOOTAGE_BUCKET.id) {
      return yield* new StorageDeleteRefusedError({
        bucketId: opts.bucketId,
        reason: "not-deletable",
        message: `${UNUSED_IMPORTED_FOOTAGE_BUCKET.name} is never deleted by CVM: it can only be moved`,
      });
    }
    if (bucketId === undefined) {
      return yield* new StorageDeleteRefusedError({
        bucketId: opts.bucketId,
        reason: "not-deletable",
        message: `"${opts.bucketId}" can't be deleted from the Storage page: only the Overlay Render Cache, export scratch and Exported Videos of no current Video can`,
      });
    }

    const encoding = yield* Effect.tryPromise({
      try: () => encodingJobs(opts.db, opts.selfJobId),
      catch: (cause) =>
        new StorageDeleteFailedError({
          bucketId,
          message: `Could not check for a running export: ${messageOf(cause)}`,
        }),
    });
    if (encoding.length > 0) {
      return yield* new StorageDeleteRefusedError({
        bucketId,
        reason: "export-running",
        message: encodingRefusalMessage(encoding),
      });
    }

    if (bucketId === ORPHANED_EXPORTS_BUCKET.id) {
      const marker = path.join(
        writeFolder(opts.roots, STORAGE_FOLDERS.finishedVideos),
        EXPORT_HASH_RENAME_MARKER
      );
      const renamed = yield* Effect.tryPromise({
        // A marker that can't be read counts as missing: refused.
        try: () =>
          nodeFs.access(marker).then(
            () => true,
            () => false
          ),
        catch: (cause) =>
          new StorageDeleteFailedError({ bucketId, message: messageOf(cause) }),
      });
      if (!renamed) {
        return yield* new StorageDeleteRefusedError({
          bucketId,
          reason: "exports-not-renamed",
          message:
            "Not deleted: the Exported Video rename to root-relative Export Hashes has not been recorded (apps/local/scripts/storage-rename-exports.ts --apply). Until then every Exported Video looks orphaned.",
        });
      }
    }

    const ownership = yield* loadStorageOwnership(opts.db, opts.roots).pipe(
      Effect.mapError(
        (e) => new StorageDeleteFailedError({ bucketId, message: e.message })
      )
    );

    return yield* Effect.tryPromise({
      try: async (): Promise<StorageDeleteResult> => {
        const { realRoots, realFootageFolders } = await realRootsAndFootage(
          opts.roots
        );
        const realConfine = await realConfineOf(opts.confineTo);
        const result: StorageDeleteResult = {
          bucketId,
          deleted: [],
          left: [],
        };
        const dryRun = opts.dryRun ?? false;
        const named =
          opts.files === undefined
            ? null
            : new Set(opts.files.map((f) => `${f.location}\0${f.path}`));
        const listed: { at: Location; files: string[] }[] = [];
        for (const at of locationsOf(bucketId, opts.roots, opts.scratchDir)) {
          try {
            // A root or folder that is missing or Offline has nothing to delete.
            const all = await listFiles(at.folder);
            listed.push({
              at,
              files:
                named === null
                  ? all
                  : all.filter((file) =>
                      named.has(
                        `${at.location}\0${path.relative(at.location, file).split(path.sep).join("/")}`
                      )
                    ),
            });
          } catch {
            continue;
          }
        }
        const total = listed.reduce((n, l) => n + l.files.length, 0);
        let progressed = 0;
        for (const { at, files } of listed) {
          if (named !== null && files.length === 0) continue;
          const unsafe = await folderRefusal(at, realRoots, realConfine);
          if (unsafe !== null) {
            result.left.push({
              path: path.relative(at.location, at.folder) || ".",
              location: at.location,
              message: `Left, all ${files.length} files: ${unsafe}`,
            });
            continue;
          }
          let count = 0;
          let bytes = 0;
          for (const file of files) {
            stopIfCancelled(opts.cancelRequested);
            progressed += 1;
            opts.onProgress?.(progressed, total);
            // GC's switch, not an export: never deleted, and not news.
            if (path.basename(file) === EXPORT_HASH_RENAME_MARKER) continue;
            if (!inBucket(bucketId, at, file, ownership)) continue;
            const shown = path
              .relative(at.location, file)
              .split(path.sep)
              .join("/");
            const refusal = await fileRefusal({
              at,
              file,
              realFootageFolders,
              exportsOnly: bucketId === ORPHANED_EXPORTS_BUCKET.id,
            });
            if (refusal !== null) {
              result.left.push({
                path: shown,
                location: at.location,
                message: `Left: ${refusal}`,
              });
              continue;
            }
            try {
              const size = (await nodeFs.lstat(file)).size;
              if (!dryRun) await nodeFs.unlink(file);
              count += 1;
              bytes += size;
            } catch (error) {
              // Windows has it open, say: left and reported, not fatal.
              result.left.push({
                path: shown,
                location: at.location,
                message: messageOf(error),
              });
            }
          }
          if (count > 0) {
            result.deleted.push({ location: at.location, files: count, bytes });
          }
          if (!dryRun && bucketId !== ORPHANED_EXPORTS_BUCKET.id) {
            await removeEmptyFolders(at.folder);
          }
        }
        return result;
      },
      catch: (cause) =>
        cancelledOr(
          cause,
          () =>
            new StorageDeleteFailedError({
              bucketId,
              message: messageOf(cause),
            })
        ),
    });
  }).pipe(
    Effect.tap((r) =>
      opts.dryRun
        ? Effect.void
        : Effect.logInfo(
            `[storage] deleted ${r.bucketId}: ${r.deleted.reduce((n, d) => n + d.files, 0)} files, ${r.left.length} left`
          )
    ),
    // Never beside a move being started, or another delete (#2109).
    (deletion) =>
      opts.alreadyHeld
        ? deletion
        : holdingStorageWrites(
            "a delete",
            (heldBy) =>
              new StorageDeleteRefusedError({
                bucketId: opts.bucketId,
                reason: "storage-busy",
                message: storageBusyMessage(heldBy),
              }),
            deletion
          )
  );
