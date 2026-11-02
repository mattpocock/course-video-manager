import path from "node:path";
import { isImportedFootage } from "./imported-footage";
import { MOVE_PARTIAL_SUFFIX } from "./move-wire";
import { rootRelativePath, STORAGE_FOLDERS } from "./storage-roots";

/**
 * A Storage Bucket: the unit the Storage page counts (and later moves) space
 * in. Each Course; Standalone Videos; Shorts; Shared Footage (Footage used by
 * more than one Course's Clips, listing those Courses); Unused
 * Footage (Footage under `raw-footage/` no Clip, live or archived, uses, and
 * no Recording Session still recording or under 7 days old); Used and Unused
 * Imported Footage (everything under `raw-footage/imported/`, split by whether
 * a Clip, live or archived, uses it); and the Other buckets.
 */
export type StorageBucketKind =
  | "course"
  | "standalone-videos"
  | "shorts"
  | "shared-footage"
  | "unused-footage"
  | "used-imported-footage"
  | "unused-imported-footage"
  | "clip-mockups"
  | "overlay-render-cache"
  | "export-scratch"
  | "orphaned-exports"
  | "move-partials";

export type StorageBucket = {
  readonly id: string;
  readonly kind: StorageBucketKind;
  readonly name: string;
  /**
   * Shared Footage and Used Imported Footage only: the names of the Courses
   * whose Clips use it.
   */
  readonly sharedBy?: readonly string[];
};

/** What a counted file is, inside its bucket. */
export type StorageFileKind = "footage" | "exported-videos" | "other";

/**
 * What a file is, finer than its kind, for the per-bucket page: a take, a
 * Recording Session's camera/screen/mic file, a transcript or Whisper piece
 * kept beside Footage, an Exported Video or its companion (`.sha256`), or one
 * of the Other buckets' files.
 */
export type StorageFileRole =
  | "footage"
  | "recording-session"
  | "footage-companion"
  | "exported-video"
  | "export-companion"
  | "clip-mockup"
  | "overlay-render"
  | "export-scratch"
  | "move-partial";

export const STANDALONE_VIDEOS_BUCKET: StorageBucket = {
  id: "standalone-videos",
  kind: "standalone-videos",
  name: "Standalone Videos",
};
export const SHORTS_BUCKET: StorageBucket = {
  id: "shorts",
  kind: "shorts",
  name: "Shorts",
};
export const UNUSED_FOOTAGE_BUCKET: StorageBucket = {
  id: "unused-footage",
  kind: "unused-footage",
  name: "Unused Footage",
};
/**
 * Imported Footage no Clip, live or archived, uses. Never Unused Footage:
 * CVM never deletes it, at any age; it can only be moved.
 */
export const UNUSED_IMPORTED_FOOTAGE_BUCKET: StorageBucket = {
  id: "unused-imported-footage",
  kind: "unused-imported-footage",
  name: "Unused Imported Footage",
};
export const CLIP_MOCKUPS_BUCKET: StorageBucket = {
  id: "clip-mockups",
  kind: "clip-mockups",
  name: "Clip Mockups",
};
export const OVERLAY_RENDER_CACHE_BUCKET: StorageBucket = {
  id: "overlay-render-cache",
  kind: "overlay-render-cache",
  name: "Overlay Render Cache",
};
export const EXPORT_SCRATCH_BUCKET: StorageBucket = {
  id: "export-scratch",
  kind: "export-scratch",
  name: "Export scratch",
};
/**
 * A Storage move's `.cvm-move-partial` copies (#2169): counted on their own,
 * never as Footage, so wasted space shows. The Sidecar removes each once the
 * move that made it has ended; the page never deletes or moves them.
 */
export const MOVE_PARTIALS_BUCKET: StorageBucket = {
  id: "move-partials",
  kind: "move-partials",
  name: "Unfinished move copies",
};
export const ORPHANED_EXPORTS_BUCKET: StorageBucket = {
  id: "orphaned-exports",
  kind: "orphaned-exports",
  name: "Exported Videos of no current Video",
};
const SHARED_FOOTAGE_ID = "shared-footage";
/** The Used Imported Footage bucket's id. */
export const USED_IMPORTED_FOOTAGE_ID = "used-imported-footage";

export const courseBucketId = (courseId: string) => `course:${courseId}`;

/** What the database says owns which file. Built by `loadStorageOwnership`. */
export type StorageOwnershipInput = {
  readonly courses: readonly { id: string; name: string }[];
  readonly videos: readonly {
    id: string;
    courseId: string | null;
    format: string;
    /** The names in `finished-videos/` that are this Video's export. */
    exportNames: readonly string[];
  }[];
  /** Every stored Footage path a Clip or Recording Session of a Video uses. */
  readonly footageUses: readonly {
    stored: string;
    videoId: string | null;
    /** A Recording Session's camera, screen or mic file. */
    recordingSession?: boolean;
  }[];
  /**
   * Stored paths no Clip uses that are still never Unused Footage to delete:
   * an AV Calibration's files, a Video's original footage path. They are
   * counted where the scan finds them (Unused Footage, under `raw-footage/`),
   * but deleting them is refused.
   */
  readonly keptFootage?: readonly string[];
};

export type StorageOwnership = {
  readonly buckets: readonly StorageBucket[];
  /** Root-relative Footage path → bucket id. */
  readonly footage: ReadonlyMap<string, string>;
  /** Export file name (no companion suffix) → bucket id. */
  readonly exports: ReadonlyMap<string, string>;
  /** Root-relative paths of Recording Sessions' camera, screen and mic files. */
  readonly recordingSessionFootage: ReadonlySet<string>;
  /**
   * Bucket id → the Videos whose files are in it: whose Clips or Recording
   * Sessions use its Footage, or whose current Exported Video it holds. What a
   * move asks about before it starts (a running export, a recording).
   */
  readonly videosByBucket: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Root-relative Footage path → the Videos whose Clips or Recording Sessions
   * use it: what the Imported Footage page names beside each file (#2537).
   */
  readonly videosByFootage: ReadonlyMap<string, ReadonlySet<string>>;
  /** Root-relative paths that are never deleted as Unused (`keptFootage`). */
  readonly keptFootage: ReadonlySet<string>;
};

/**
 * Assign every used Footage file and every current Exported Video to its
 * Storage Bucket. Footage used by Clips in more than one Course goes to the
 * single Shared Footage bucket, so it is counted once and never moved out from
 * under another Course. Imported Footage a Clip uses goes to Used Imported
 * Footage, never to a Course: it is moved on its own, like Shared Footage.
 */
export const assignStorageBuckets = (
  input: StorageOwnershipInput,
  roots: readonly string[]
): StorageOwnership => {
  const courseBuckets = new Map<string, StorageBucket>(
    input.courses.map((c) => [
      c.id,
      { id: courseBucketId(c.id), kind: "course", name: c.name },
    ])
  );
  const bucketOfVideo = new Map<string, StorageBucket>();
  for (const video of input.videos) {
    const bucket =
      (video.courseId !== null ? courseBuckets.get(video.courseId) : null) ??
      (video.format === "short" ? SHORTS_BUCKET : STANDALONE_VIDEOS_BUCKET);
    bucketOfVideo.set(video.id, bucket);
  }

  const exports = new Map<string, string>();
  for (const video of input.videos) {
    const bucket = bucketOfVideo.get(video.id)!;
    for (const name of video.exportNames) {
      if (!exports.has(name)) exports.set(name, bucket.id);
    }
  }

  const users = new Map<string, Set<StorageBucket>>();
  const recordingSessionFootage = new Set<string>();
  for (const use of input.footageUses) {
    const relative = rootRelativePath(use.stored, roots);
    if (relative === null) continue;
    if (use.recordingSession) recordingSessionFootage.add(relative);
    const bucket =
      (use.videoId !== null ? bucketOfVideo.get(use.videoId) : undefined) ??
      STANDALONE_VIDEOS_BUCKET;
    const set = users.get(relative) ?? new Set<StorageBucket>();
    set.add(bucket);
    users.set(relative, set);
  }

  // Shared Footage is Footage used by Clips in more than one Course. Used by
  // one Course (and any Standalone Video or Short) it is that Course's; by no
  // Course, it is Standalone Videos' (unless only Shorts use it).
  const footage = new Map<string, string>();
  const sharers = new Map<string, StorageBucket>();
  const importers = new Map<string, StorageBucket>();
  for (const [relative, set] of users) {
    const courses = [...set].filter((b) => b.kind === "course");
    if (isImportedFootage(relative)) {
      footage.set(relative, USED_IMPORTED_FOOTAGE_ID);
      for (const course of courses) importers.set(course.id, course);
    } else if (courses.length > 1) {
      footage.set(relative, SHARED_FOOTAGE_ID);
      for (const course of courses) sharers.set(course.id, course);
    } else if (courses.length === 1) {
      footage.set(relative, courses[0]!.id);
    } else if (set.size === 1) {
      footage.set(relative, [...set][0]!.id);
    } else {
      footage.set(relative, STANDALONE_VIDEOS_BUCKET.id);
    }
  }

  const videosByBucket = new Map<string, Set<string>>();
  const addVideo = (bucketId: string, videoId: string) => {
    const set = videosByBucket.get(bucketId) ?? new Set<string>();
    set.add(videoId);
    videosByBucket.set(bucketId, set);
  };
  const videosByFootage = new Map<string, Set<string>>();
  for (const use of input.footageUses) {
    if (use.videoId === null) continue;
    const relative = rootRelativePath(use.stored, roots);
    if (relative === null) continue;
    const bucketId = footage.get(relative);
    if (bucketId !== undefined) addVideo(bucketId, use.videoId);
    const users = videosByFootage.get(relative) ?? new Set<string>();
    users.add(use.videoId);
    videosByFootage.set(relative, users);
  }
  for (const video of input.videos) {
    for (const name of video.exportNames) {
      const bucketId = exports.get(name);
      if (bucketId !== undefined) addVideo(bucketId, video.id);
    }
  }

  const namesOf = (buckets: Map<string, StorageBucket>) =>
    [...buckets.values()].map((b) => b.name).sort((a, b) => a.localeCompare(b));
  return {
    buckets: [
      ...courseBuckets.values(),
      STANDALONE_VIDEOS_BUCKET,
      SHORTS_BUCKET,
      {
        id: SHARED_FOOTAGE_ID,
        kind: "shared-footage",
        name: "Shared Footage",
        sharedBy: namesOf(sharers),
      },
      UNUSED_FOOTAGE_BUCKET,
      {
        id: USED_IMPORTED_FOOTAGE_ID,
        kind: "used-imported-footage",
        name: "Used Imported Footage",
        sharedBy: namesOf(importers),
      },
      UNUSED_IMPORTED_FOOTAGE_BUCKET,
      CLIP_MOCKUPS_BUCKET,
      OVERLAY_RENDER_CACHE_BUCKET,
      EXPORT_SCRATCH_BUCKET,
      ORPHANED_EXPORTS_BUCKET,
      MOVE_PARTIALS_BUCKET,
    ],
    footage,
    exports,
    recordingSessionFootage,
    videosByBucket,
    videosByFootage,
    keptFootage: new Set(
      (input.keptFootage ?? [])
        .map((stored) => rootRelativePath(stored, roots))
        .filter((r): r is string => r !== null)
    ),
  };
};

/**
 * The Footage a file under `raw-footage/` belongs with: itself, or — for a
 * transcript or Whisper piece kept beside it (`a.mkv.transcript.json`) — the
 * longest used Footage path it extends. Used by nothing, it is Unused
 * Imported Footage when it is under `raw-footage/imported/` (an import's
 * partial file and every companion too), else Unused Footage.
 */
const footageOwner = (
  ownership: StorageOwnership,
  relative: string
): { bucketId: string; companionOf: string | null } => {
  const exact = ownership.footage.get(relative);
  if (exact !== undefined) return { bucketId: exact, companionOf: null };
  for (let i = relative.length - 1; i > 0; i--) {
    const ch = relative[i];
    if (ch !== "." && ch !== "/") continue;
    const footage = relative.slice(0, i);
    const owner = ownership.footage.get(footage);
    if (owner !== undefined) return { bucketId: owner, companionOf: footage };
  }
  const unused = isImportedFootage(relative)
    ? UNUSED_IMPORTED_FOOTAGE_BUCKET
    : UNUSED_FOOTAGE_BUCKET;
  return { bucketId: unused.id, companionOf: null };
};

/** `x.mp4.sha256` and other companions are counted with `x.mp4`. */
const exportName = (file: string) => {
  const at = file.indexOf(".mp4");
  return at === -1 ? file : file.slice(0, at + ".mp4".length);
};

/** Which bucket a file is counted in, as what, and (for a companion) beside what. */
export type StorageFileClass = {
  readonly bucketId: string;
  readonly kind: StorageFileKind;
  readonly role: StorageFileRole;
  /** A companion's file (root-relative): the Footage or Exported Video it sits beside. */
  readonly companionOf: string | null;
};

/** The folders a Storage move writes partial copies into. */
const isMoveFolder = (folder: string) =>
  folder === STORAGE_FOLDERS.rawFootage ||
  folder === STORAGE_FOLDERS.finishedVideos ||
  folder === STORAGE_FOLDERS.clipMockups;

/**
 * Which bucket a file under a Storage Root is counted in, and as what.
 * `relative` is root-relative (`raw-footage/a.mkv`). Null for a file outside
 * CVM's folders, which the scan never walks.
 */
export const classifyStorageFile = (
  ownership: StorageOwnership,
  relative: string
): StorageFileClass | null => {
  const folder = relative.split("/")[0] ?? "";
  if (relative.endsWith(MOVE_PARTIAL_SUFFIX) && isMoveFolder(folder)) {
    return {
      bucketId: MOVE_PARTIALS_BUCKET.id,
      kind: "other",
      role: "move-partial",
      companionOf: null,
    };
  }
  switch (folder) {
    case STORAGE_FOLDERS.rawFootage: {
      const owner = footageOwner(ownership, relative);
      const role: StorageFileRole =
        owner.companionOf !== null
          ? "footage-companion"
          : ownership.recordingSessionFootage.has(relative)
            ? "recording-session"
            : "footage";
      return { ...owner, kind: "footage", role };
    }
    case STORAGE_FOLDERS.finishedVideos: {
      const name = exportName(path.posix.basename(relative));
      const isCompanion = name !== path.posix.basename(relative);
      return {
        bucketId: ownership.exports.get(name) ?? ORPHANED_EXPORTS_BUCKET.id,
        kind: "exported-videos",
        role: isCompanion ? "export-companion" : "exported-video",
        companionOf: isCompanion
          ? path.posix.join(path.posix.dirname(relative), name)
          : null,
      };
    }
    case STORAGE_FOLDERS.clipMockups:
      return {
        bucketId: CLIP_MOCKUPS_BUCKET.id,
        kind: "other",
        role: "clip-mockup",
        companionOf: null,
      };
    case STORAGE_FOLDERS.overlayRenders:
      return {
        bucketId: OVERLAY_RENDER_CACHE_BUCKET.id,
        kind: "other",
        role: "overlay-render",
        companionOf: null,
      };
    default:
      return null;
  }
};
