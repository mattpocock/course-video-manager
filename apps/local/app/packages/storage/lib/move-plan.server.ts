import nodeFs from "node:fs/promises";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { Effect } from "effect";
import { jobs, recordingSessions } from "@cvm/core/db/schema";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { storageWritesHeldBy } from "./storage-busy";
import { classifyStorageFile, type StorageOwnership } from "./buckets";
import { loadStorageOwnership } from "./ownership.server";
import {
  movableKindsOf,
  STORAGE_MOVE_JOB_KIND,
  STORAGE_MOVE_KIND_LABELS,
  type StorageMoveKind,
  type StorageMovePlan,
  type StorageMoveRefusal,
} from "./move-wire";
import {
  gb,
  lstatOrNull,
  MOVE_PARTIAL_SUFFIX,
  realpathOrNull,
  realStorageMoveDisk,
  StorageMoveFailedError,
  messageOf,
  type StorageMoveDisk,
} from "./move-io.server";
import {
  rootLabel,
  STORAGE_FOLDERS,
  type StorageFolder,
  type StorageRoots,
} from "./storage-roots";

/** Planning a Storage move: what is where, and every reason not to start. */

export const FOLDER_OF: Record<StorageMoveKind, StorageFolder> = {
  footage: STORAGE_FOLDERS.rawFootage,
  "exported-videos": STORAGE_FOLDERS.finishedVideos,
  "clip-mockups": STORAGE_FOLDERS.clipMockups,
};

export const FILE_KIND_OF = {
  footage: "footage",
  "exported-videos": "exported-videos",
  "clip-mockups": "other",
} as const;

export const ENCODING_JOB_KINDS = [
  "export",
  "export-animatic",
  "render-vertical",
];
export const WHOLE_COURSE_ENCODING_KINDS = ["batch-export", "publish"];

/**
 * Why `<root>/<folder>` must not be read from or written to, or null. It must
 * be a real directory at exactly that place, not a link to somewhere else (a
 * verify run once reached real Footage through a symlinked `raw-footage/`).
 * A folder that is not there yet is fine: it is made under the real root.
 */
export const folderRefusal = async (root: string, folder: string) => {
  const at = path.join(root, folder);
  const info = await lstatOrNull(at);
  if (info === null) return null;
  if (!info.isDirectory()) {
    return `${at} is not a folder (a link?): nothing is moved through it`;
  }
  const realRoot = await realpathOrNull(root);
  const real = await realpathOrNull(at);
  if (realRoot === null || real !== path.join(realRoot, folder)) {
    return `${at} really is ${real ?? "unresolvable"}, not inside ${root}: nothing is moved through it`;
  }
  return null;
};

/** Every regular file under `dir`, relative to `root`; links are reported. */
export const listFolder = async (
  root: string,
  dir: string,
  links: string[]
): Promise<{ relative: string; bytes: number }[]> => {
  const out: { relative: string; bytes: number }[] = [];
  const entries = await nodeFs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(root, full).split(path.sep).join("/");
    if (entry.isDirectory()) out.push(...(await listFolder(root, full, links)));
    else if (entry.isFile()) {
      const info = await lstatOrNull(full);
      if (info) out.push({ relative, bytes: Number(info.size) });
    } else if (entry.isSymbolicLink()) links.push(relative);
  }
  return out;
};

export type PlannedFile = {
  /** Root-relative. */
  readonly path: string;
  /** The root it is copied from: the first root, other than the target, with it. */
  readonly from: string;
  readonly bytes: number;
  readonly state: "copy" | "on-target" | "conflict";
};

export type Gathered = {
  readonly plan: StorageMovePlan;
  readonly files: readonly PlannedFile[];
  /** Links found where files were expected: never followed, never moved. */
  readonly links: readonly string[];
};

/** What the database says is running that the move must not run beside. */
export const busyRefusals = async (opts: {
  readonly db: Database;
  readonly bucketId: string;
  readonly kind: StorageMoveKind;
  readonly videos: ReadonlySet<string>;
  readonly selfJobId: string | null;
}): Promise<StorageMoveRefusal[]> => {
  const refusals: StorageMoveRefusal[] = [];
  const live = await opts.db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      title: jobs.title,
      params: jobs.params,
    })
    .from(jobs)
    .where(inArray(jobs.status, ["queued", "running"]));
  const paramOf = (params: unknown, key: string) =>
    typeof params === "object" && params !== null && key in params
      ? (params as Record<string, unknown>)[key]
      : undefined;

  const moving = live.find(
    (j) =>
      j.kind === STORAGE_MOVE_JOB_KIND &&
      j.id !== opts.selfJobId &&
      paramOf(j.params, "bucketId") === opts.bucketId
  );
  if (moving) {
    refusals.push({
      reason: "move-running",
      message: `"${moving.title}" is already queued or running for this bucket`,
    });
  }

  // A delete Job (a Purge, a delete, the trash, "Delete originals") empties
  // the very folders a move copies from (#2157).
  const deleting = live.find((j) => j.kind === "storage-delete");
  if (deleting) {
    refusals.push({
      reason: "storage-busy",
      message: `"${deleting.title}" is queued or running; try again once it has finished`,
    });
  }

  if (opts.kind === "clip-mockups") {
    const voicing = live.find((j) => j.kind === "clip-mockup-voice");
    if (voicing) {
      refusals.push({
        reason: "voice-running",
        message: `A Clip Mockup's voice is being made ("${voicing.title}"), which writes into clip-mockups/. Try again once it has finished.`,
      });
    }
    return refusals;
  }

  const exporting = live.find(
    (j) =>
      WHOLE_COURSE_ENCODING_KINDS.includes(j.kind) ||
      (ENCODING_JOB_KINDS.includes(j.kind) &&
        opts.videos.has(String(paramOf(j.params, "videoId"))))
  );
  if (exporting) {
    refusals.push({
      reason: "export-running",
      message: `An export is queued or running for a Video in this bucket ("${exporting.title}"). Try again once it has finished.`,
    });
  }

  if (opts.kind === "footage") {
    // A CVM-recorder take is being written into raw-footage/ right now.
    const recording = await opts.db
      .select({ id: recordingSessions.id, videoId: recordingSessions.videoId })
      .from(recordingSessions)
      .where(inArray(recordingSessions.status, ["recording"]));
    if (recording.length > 0) {
      const inBucket = recording.some(
        (r) => r.videoId !== null && opts.videos.has(r.videoId)
      );
      refusals.push({
        reason: "recording-active",
        message: inBucket
          ? "A Recording Session is active for a Video in this bucket. Stop recording first."
          : "A Recording Session is active, writing new Footage into raw-footage/. Stop recording first.",
      });
    }
  }
  return refusals;
};

/**
 * Plan the move: which of the bucket's files of `kind` are where, what has to
 * be copied, and every reason not to start. Reads only.
 */
export const gather = (opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly bucketId: string;
  readonly kind: StorageMoveKind;
  readonly target: string;
  readonly disk: StorageMoveDisk;
  readonly selfJobId: string | null;
  /** Started by `startStorageMove`, which holds the write hold itself. */
  readonly holdIsOurs?: boolean;
  /** Only these files (root-relative), and their companions; absent, all. */
  readonly paths?: readonly string[];
}): Effect.Effect<Gathered, StorageMoveFailedError> =>
  Effect.gen(function* () {
    const ownership: StorageOwnership = yield* loadStorageOwnership(
      opts.db,
      opts.roots
    ).pipe(
      Effect.mapError((e) => new StorageMoveFailedError({ message: e.message }))
    );
    return yield* Effect.tryPromise({
      try: () => gatherFiles({ ...opts, ownership }),
      catch: (cause) =>
        new StorageMoveFailedError({
          message: `Could not plan the move: ${messageOf(cause)}`,
        }),
    });
  });

export const gatherFiles = async (opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly bucketId: string;
  readonly kind: StorageMoveKind;
  readonly target: string;
  readonly disk: StorageMoveDisk;
  readonly selfJobId: string | null;
  readonly holdIsOurs?: boolean;
  readonly paths?: readonly string[];
  readonly ownership: StorageOwnership;
}): Promise<Gathered> => {
  const only = opts.paths === undefined ? null : new Set(opts.paths);
  const { roots, target, kind } = opts;
  const bucket = opts.ownership.buckets.find((b) => b.id === opts.bucketId);
  const targetLabel = rootLabel(target);
  const refusals: StorageMoveRefusal[] = [];
  const empty = (reason: StorageMoveRefusal): Gathered => ({
    plan: {
      bucketId: opts.bucketId,
      bucketName: bucket?.name ?? opts.bucketId,
      kind,
      target,
      targetLabel,
      files: 0,
      bytes: 0,
      filesToCopy: 0,
      bytesToCopy: 0,
      filesOnTarget: 0,
      conflicts: 0,
      freeBytes: null,
      refusals: [reason],
    },
    files: [],
    links: [],
  });
  if (!bucket) {
    return empty({
      reason: "not-movable",
      message: `No Storage Bucket "${opts.bucketId}"`,
    });
  }
  if (!movableKindsOf(bucket).includes(kind)) {
    return empty({
      reason: "not-movable",
      message: `${bucket.name}'s ${STORAGE_MOVE_KIND_LABELS[kind]} can't be moved`,
    });
  }
  if (!roots.includes(target)) {
    return empty({
      reason: "unknown-target",
      message: `${target} is not a Storage Root`,
    });
  }

  const folder = FOLDER_OF[kind];
  const targetOnline = await nodeFs.readdir(target).then(
    () => true,
    () => false
  );
  if (!targetOnline) {
    refusals.push({
      reason: "target-offline",
      message: `${targetLabel} is Offline: plug it in first`,
    });
  } else {
    const unsafe = await folderRefusal(target, folder);
    if (unsafe) refusals.push({ reason: "unsafe-folder", message: unsafe });
  }

  // Every copy of each file, on every readable root, in root order.
  const copies = new Map<string, { root: string; bytes: number }[]>();
  const links: string[] = [];
  for (const root of roots) {
    const dir = path.join(root, folder);
    if ((await lstatOrNull(dir)) === null) continue;
    const unsafe = await folderRefusal(root, folder);
    if (unsafe) {
      // The target's was reported above.
      if (root !== target) {
        refusals.push({ reason: "unsafe-folder", message: unsafe });
      }
      continue;
    }
    let found: { relative: string; bytes: number }[];
    try {
      found = await listFolder(root, dir, root === target ? [] : links);
    } catch {
      continue; // an Offline or unreadable source root: its files stay put
    }
    for (const f of found) {
      if (f.relative.endsWith(MOVE_PARTIAL_SUFFIX)) continue;
      const owner = classifyStorageFile(opts.ownership, f.relative);
      if (
        owner === null ||
        owner.bucketId !== bucket.id ||
        owner.kind !== FILE_KIND_OF[kind]
      )
        continue;
      // One file (and whatever is kept beside it) from the per-bucket page.
      if (only !== null && !only.has(owner.companionOf ?? f.relative)) continue;
      const list = copies.get(f.relative) ?? [];
      list.push({ root, bytes: f.bytes });
      copies.set(f.relative, list);
    }
  }

  const files: PlannedFile[] = [];
  for (const [relative, list] of [...copies].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    const source = list.find((c) => c.root !== target);
    if (!source) continue; // only on the target already: nothing to do
    const onTarget = list.find((c) => c.root === target);
    files.push({
      path: relative,
      from: source.root,
      bytes: source.bytes,
      state:
        onTarget === undefined
          ? "copy"
          : onTarget.bytes === source.bytes
            ? "on-target"
            : "conflict",
    });
  }
  // A file on the target already that a link in its path hides is not seen
  // above; `copyOne` checks the real destination again before writing.

  const toCopy = files.filter((f) => f.state === "copy");
  const bytesToCopy = toCopy.reduce((n, f) => n + f.bytes, 0);
  let freeBytes: number | null = null;
  if (targetOnline) {
    freeBytes = await opts.disk.freeBytes(target).catch(() => null);
    if (freeBytes !== null && bytesToCopy > freeBytes) {
      refusals.push({
        reason: "no-room",
        message: `${targetLabel} has ${gb(freeBytes)} free; this move needs ${gb(bytesToCopy)}`,
      });
    }
  }
  if (files.length === 0) {
    refusals.push({
      reason: "nothing-to-move",
      message: `${bucket.name} has no ${STORAGE_MOVE_KIND_LABELS[kind]} off ${targetLabel}`,
    });
  }
  const heldBy = opts.holdIsOurs ? null : storageWritesHeldBy();
  if (heldBy !== null) {
    refusals.push({
      reason: "storage-busy",
      message: `${heldBy} is under way on the Storage page; try again once it has finished`,
    });
  }
  refusals.push(
    ...(await busyRefusals({
      db: opts.db,
      bucketId: bucket.id,
      kind,
      videos: opts.ownership.videosByBucket.get(bucket.id) ?? new Set(),
      selfJobId: opts.selfJobId,
    }))
  );

  return {
    plan: {
      bucketId: bucket.id,
      bucketName: bucket.name,
      kind,
      target,
      targetLabel,
      files: files.length,
      bytes: files.reduce((n, f) => n + f.bytes, 0),
      filesToCopy: toCopy.length,
      bytesToCopy,
      filesOnTarget: files.filter((f) => f.state === "on-target").length,
      conflicts: files.filter((f) => f.state === "conflict").length,
      freeBytes,
      refusals,
    },
    files,
    links,
  };
};

/**
 * What moving a bucket's files of `kind` to `target` would do, for the
 * confirmation: sizes, the target's free space, and every refusal. Reads only.
 */
export const planStorageMove = (opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly bucketId: string;
  readonly kind: StorageMoveKind;
  readonly target: string;
  readonly disk?: StorageMoveDisk;
  readonly holdIsOurs?: boolean;
  readonly paths?: readonly string[];
}): Effect.Effect<StorageMovePlan, StorageMoveFailedError> =>
  gather({
    ...opts,
    disk: opts.disk ?? realStorageMoveDisk,
    selfJobId: null,
  }).pipe(Effect.map((g) => g.plan));
