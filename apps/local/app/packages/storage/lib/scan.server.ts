import { statfs } from "node:fs/promises";
import path from "node:path";
import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import {
  classifyStorageFile,
  EXPORT_SCRATCH_BUCKET,
  type StorageFileClass,
  type StorageOwnership,
} from "./buckets";
import type { DirtyBitReader } from "./dirty-bit";
import { remountCommandFor } from "./offline";
import { loadStorageOwnership } from "./ownership.server";
import type {
  StorageBucketFilesMessage,
  StorageFileFound,
  StorageRootReport,
  StorageScanMessage,
  StorageSizeDelta,
} from "./scan-wire";
import { rootLabel, STORAGE_FOLDERS, type StorageRoots } from "./storage-roots";
import { nowMs } from "@/packages/clock";

/** Flush counted sizes after this many files, or this long, whichever first. */
const FLUSH_EVERY_FILES = 200;
const FLUSH_EVERY_MS = 250;
/** How many files in one folder are stat-ed at once. */
const STAT_CONCURRENCY = 16;

const messageOf = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e !== null && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

/**
 * Each root's size, free space and dirty bit; a root that can't be read (not
 * mounted, or a stale WSL mount) is Offline.
 */
const measureRoots = (roots: StorageRoots, readDirtyBit: DirtyBitReader) =>
  Effect.forEach(
    roots,
    (root): Effect.Effect<StorageRootReport, never, FileSystem.FileSystem> =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const label = rootLabel(root);
        const readable = yield* fs.readDirectory(root).pipe(Effect.either);
        if (readable._tag === "Left") {
          return {
            root,
            label,
            online: false,
            reason: messageOf(readable.left),
            remountCommand: remountCommandFor(root),
          } as const;
        }
        const dirtyBit = yield* readDirtyBit(root);
        return yield* Effect.tryPromise(() => statfs(root)).pipe(
          Effect.map((s): StorageRootReport => ({
            root,
            label,
            online: true,
            totalBytes: s.blocks * s.bsize,
            freeBytes: s.bavail * s.bsize,
            dirtyBit,
          })),
          Effect.orElseSucceed((): StorageRootReport => ({
            root,
            label,
            online: false,
            reason: "could not read its free space",
            remountCommand: remountCommandFor(root),
          }))
        );
      }),
    { concurrency: "unbounded" }
  );

/**
 * Every file under `dir`, with its size, handed to `onFile` as it is found.
 * A file that vanishes mid-walk is skipped; a folder that can't be read fails.
 */
const walk = (
  dir: string,
  onFile: (file: string, bytes: number) => Effect.Effect<void>
): Effect.Effect<void, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const names = yield* fs.readDirectory(dir);
    const subdirs: string[] = [];
    yield* Effect.forEach(
      names,
      (name) => {
        const full = path.join(dir, name);
        return fs.stat(full).pipe(
          Effect.flatMap((info) => {
            if (info.type === "Directory") {
              subdirs.push(full);
              return Effect.void;
            }
            if (info.type !== "File") return Effect.void;
            return onFile(full, Number(info.size));
          }),
          // A file that vanished mid-walk is not counted, and not fatal.
          Effect.catchAll((error) =>
            Effect.logWarning(`[storage] skipped ${full}: ${messageOf(error)}`)
          )
        );
      },
      { concurrency: STAT_CONCURRENCY, discard: true }
    );
    for (const sub of subdirs.sort()) yield* walk(sub, onFile);
  });

/**
 * Collects items and hands them over in batches: after this many items, or
 * this long, whichever first, and whenever `flush` is called.
 */
const batcher = <T>(onBatch: (items: T[]) => void) => {
  let pending: T[] = [];
  let lastFlush = nowMs();
  const flush = () => {
    if (pending.length > 0) onBatch(pending);
    pending = [];
    lastFlush = nowMs();
  };
  const add = (item: T) => {
    pending.push(item);
    if (
      pending.length >= FLUSH_EVERY_FILES ||
      nowMs() - lastFlush >= FLUSH_EVERY_MS
    ) {
      flush();
    }
  };
  return { add, flush };
};

/**
 * Walk every online root's CVM folders, then export scratch, handing each
 * file to `onFile` with where it is and what owns it. `afterLocation` runs
 * once each root (or scratch) is done, and is told if the root could not be
 * read. Pure reading.
 */
const walkStorage = (opts: {
  readonly onlineRoots: readonly string[];
  readonly ownership: StorageOwnership;
  readonly scratchDir?: string;
  readonly onFile: (
    location: string,
    relative: string,
    bytes: number,
    owner: StorageFileClass
  ) => void;
  readonly afterLocation: (location: string, unreadable: unknown) => void;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const root of opts.onlineRoots) {
      const folders = Object.values(STORAGE_FOLDERS).map((f) =>
        path.join(root, f)
      );
      const walked = yield* Effect.forEach(
        folders,
        (folder) =>
          Effect.gen(function* () {
            const exists = yield* fs
              .exists(folder)
              .pipe(Effect.orElseSucceed(() => false));
            if (!exists) return;
            yield* walk(folder, (file, bytes) =>
              Effect.sync(() => {
                const relative = path
                  .relative(root, file)
                  .split(path.sep)
                  .join("/");
                const owner = classifyStorageFile(opts.ownership, relative);
                if (owner) opts.onFile(root, relative, bytes, owner);
              })
            );
          }),
        { discard: true }
      ).pipe(Effect.either);
      opts.afterLocation(
        root,
        walked._tag === "Left" ? walked.left : undefined
      );
    }

    if (opts.scratchDir !== undefined) {
      const scratchDir = opts.scratchDir;
      const exists = yield* fs
        .exists(scratchDir)
        .pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        yield* walk(scratchDir, (file, bytes) =>
          Effect.sync(() =>
            opts.onFile(
              scratchDir,
              path.relative(scratchDir, file).split(path.sep).join("/"),
              bytes,
              EXPORT_SCRATCH_FILE
            )
          )
        ).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(
              `[storage] export scratch ${scratchDir} could not be read: ${messageOf(error)}`
            )
          )
        );
        opts.afterLocation(scratchDir, undefined);
      }
    }
  });

const EXPORT_SCRATCH_FILE: StorageFileClass = {
  bucketId: EXPORT_SCRATCH_BUCKET.id,
  kind: "other",
  role: "export-scratch",
  companionOf: null,
};

/**
 * Walk the roots (and export scratch) and stream per-bucket, per-location,
 * per-kind byte totals as they are counted. Pure reading: nothing is written,
 * moved or saved.
 */
export const scanStorageFolders = (opts: {
  readonly roots: StorageRoots;
  readonly onlineRoots: readonly string[];
  readonly ownership: StorageOwnership;
  readonly scratchDir?: string;
  readonly emit: (message: StorageScanMessage) => void;
}) => {
  const counted = batcher<StorageSizeDelta>((deltas) => {
    const sizes = new Map<string, StorageSizeDelta>();
    for (const d of deltas) {
      const key = `${d.bucketId}\u0000${d.location}\u0000${d.kind}`;
      const was = sizes.get(key);
      sizes.set(key, {
        ...d,
        bytes: (was?.bytes ?? 0) + d.bytes,
        files: (was?.files ?? 0) + d.files,
      });
    }
    opts.emit({ type: "sizes-counted", sizes: [...sizes.values()] });
  });
  return walkStorage({
    onlineRoots: opts.onlineRoots,
    ownership: opts.ownership,
    scratchDir: opts.scratchDir,
    onFile: (location, _relative, bytes, owner) =>
      counted.add({
        bucketId: owner.bucketId,
        location,
        kind: owner.kind,
        bytes,
        files: 1,
      }),
    afterLocation: (location, unreadable) => {
      counted.flush();
      if (unreadable !== undefined) {
        opts.emit({
          type: "root-unreadable",
          root: location,
          message: messageOf(unreadable),
        });
      }
    },
  });
};

/**
 * The Storage page's scan, start to finish: measure the roots, read what
 * owns each file, walk, and say when it is done. Meant to run inside an SSE
 * response: interrupting it (the page closed the stream) stops the walk, and
 * the log says so.
 */
export const streamStorageScan = (opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly scratchDir?: string;
  /** Reads each online root's dirty bit; only ever queries. */
  readonly readDirtyBit: DirtyBitReader;
  readonly emit: (message: StorageScanMessage) => void;
}) =>
  Effect.gen(function* () {
    yield* Effect.logInfo("[storage] scan started");
    const reports = yield* measureRoots(opts.roots, opts.readDirtyBit);
    opts.emit({ type: "roots-measured", roots: reports });
    const ownership = yield* loadStorageOwnership(opts.db, opts.roots);
    opts.emit({ type: "buckets-listed", buckets: [...ownership.buckets] });
    yield* scanStorageFolders({
      roots: opts.roots,
      onlineRoots: reports.filter((r) => r.online).map((r) => r.root),
      ownership,
      scratchDir: opts.scratchDir,
      emit: opts.emit,
    });
    opts.emit({ type: "scan-completed" });
    yield* Effect.logInfo("[storage] scan finished");
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.logInfo(
        "[storage] scan aborted: the page closed the stream, the walk stopped"
      )
    )
  );

/** No Storage Bucket has this id (a stale link, or a Course since deleted). */
export class StorageBucketNotFoundError extends Data.TaggedError(
  "StorageBucketNotFoundError"
)<{ readonly bucketId: string; readonly message: string }> {}

/**
 * The per-bucket page's listing (#2108): the same walk as the Storage page's
 * scan, kept to one Storage Bucket and streamed file by file, each with the
 * location it was found on (a file mid-move is found on both roots). Pure
 * reading; interrupting it (the page closed the stream) stops the walk.
 */
export const streamStorageBucketFiles = (opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly bucketId: string;
  readonly scratchDir?: string;
  /** Reads each online root's dirty bit; only ever queries. */
  readonly readDirtyBit: DirtyBitReader;
  readonly emit: (message: StorageBucketFilesMessage) => void;
}) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[storage] listing ${opts.bucketId} started`);
    const reports = yield* measureRoots(opts.roots, opts.readDirtyBit);
    opts.emit({ type: "roots-measured", roots: reports });
    const ownership = yield* loadStorageOwnership(opts.db, opts.roots);
    const bucket = ownership.buckets.find((b) => b.id === opts.bucketId);
    if (!bucket) {
      return yield* new StorageBucketNotFoundError({
        bucketId: opts.bucketId,
        message: `No Storage Bucket "${opts.bucketId}"`,
      });
    }
    opts.emit({ type: "bucket-identified", bucket });
    const found = batcher<StorageFileFound>((files) =>
      opts.emit({ type: "files-found", files })
    );
    yield* walkStorage({
      onlineRoots: reports.filter((r) => r.online).map((r) => r.root),
      ownership,
      scratchDir:
        bucket.id === EXPORT_SCRATCH_BUCKET.id ? opts.scratchDir : undefined,
      onFile: (location, relative, bytes, owner) => {
        if (owner.bucketId !== bucket.id) return;
        found.add({
          path: relative,
          location,
          bytes,
          role: owner.role,
          companionOf: owner.companionOf,
        });
      },
      afterLocation: (location, unreadable) => {
        found.flush();
        if (unreadable !== undefined) {
          opts.emit({
            type: "root-unreadable",
            root: location,
            message: messageOf(unreadable),
          });
        }
      },
    });
    opts.emit({ type: "scan-completed" });
    yield* Effect.logInfo(`[storage] listing ${opts.bucketId} finished`);
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.logInfo(
        `[storage] listing ${opts.bucketId} aborted: the page closed the stream, the walk stopped`
      )
    )
  );
