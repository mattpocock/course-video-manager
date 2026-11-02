import type { StorageBucket } from "./buckets";

/**
 * What a move carries, as one: a Storage Bucket's Footage (with its
 * transcripts, Whisper pieces and Recording Session files), its Exported
 * Videos (with their companions), or the Clip Mockups.
 */
export const STORAGE_MOVE_KINDS = [
  "footage",
  "exported-videos",
  "clip-mockups",
] as const;
export type StorageMoveKind = (typeof STORAGE_MOVE_KINDS)[number];

export const STORAGE_MOVE_KIND_LABELS: Record<StorageMoveKind, string> = {
  footage: "Footage",
  "exported-videos": "Exported Videos",
  "clip-mockups": "Clip Mockups",
};

/**
 * What of a bucket can be moved. A Course, Standalone Videos and Shorts move
 * their Footage or their Exported Videos; Shared Footage, Unused Footage and
 * Used and Unused Imported Footage are Footage only; Clip Mockups move as themselves. The rest (the Overlay
 * Render Cache, export scratch, Exported Videos of no current Video) are
 * deleted, not moved (ADR 0041).
 */
export const movableKindsOf = (bucket: StorageBucket): StorageMoveKind[] => {
  switch (bucket.kind) {
    case "course":
    case "standalone-videos":
    case "shorts":
      return ["footage", "exported-videos"];
    case "shared-footage":
    case "unused-footage":
    case "used-imported-footage":
    case "unused-imported-footage":
      return ["footage"];
    case "clip-mockups":
      return ["clip-mockups"];
    case "overlay-render-cache":
    case "export-scratch":
    case "orphaned-exports":
    case "move-partials":
      return [];
  }
};

/**
 * Why a move will not start. Each is checked before a single byte is
 * copied, when the confirmation is shown and again when the Job starts.
 */
export type StorageMoveRefusalReason =
  | "not-movable"
  | "unknown-target"
  | "target-offline"
  | "unsafe-folder"
  | "no-room"
  | "export-running"
  | "recording-active"
  | "voice-running"
  | "move-running"
  | "storage-busy"
  | "nothing-to-move";

export type StorageMoveRefusal = {
  readonly reason: StorageMoveRefusalReason;
  readonly message: string;
};

/**
 * What moving one bucket's files of one kind to one Storage Root would do:
 * the confirmation's numbers, and every reason it would not start.
 */
export type StorageMovePlan = {
  readonly bucketId: string;
  readonly bucketName: string;
  readonly kind: StorageMoveKind;
  readonly target: string;
  readonly targetLabel: string;
  /** Every file of that kind in the bucket, on any root. */
  readonly files: number;
  readonly bytes: number;
  /** The files not on the target yet: what is copied, and what it needs. */
  readonly filesToCopy: number;
  readonly bytesToCopy: number;
  /** Already on the target at the same size: checked by checksum, not copied. */
  readonly filesOnTarget: number;
  /** A different file is at the destination: never overwritten, reported. */
  readonly conflicts: number;
  /** The target's free space, or null when it can't be read (Offline). */
  readonly freeBytes: number | null;
  readonly refusals: readonly StorageMoveRefusal[];
};

/**
 * What a finished move did. Nothing is ever deleted from the source:
 * "Delete originals" is a separate, deliberate step.
 */
export type StorageMoveResult = {
  readonly bucketId: string;
  readonly kind: StorageMoveKind;
  readonly target: string;
  /** Copied to the target, and checked against the original's checksum. */
  readonly copied: { readonly files: number; readonly bytes: number };
  /** Already on the target, and checked against the original's checksum. */
  readonly verified: { readonly files: number; readonly bytes: number };
  /** Not moved, and why; the original is where it was. */
  readonly left: readonly { readonly path: string; readonly message: string }[];
};

/** The Sidecar Job kind that moves a bucket, and what it reports. */
export const STORAGE_MOVE_JOB_KIND = "storage-move";
export const STORAGE_MOVE_STAGES = ["checking", "copying"] as const;
export type StorageMoveStage = (typeof STORAGE_MOVE_STAGES)[number];
export const isStorageMoveStage = (stage: string): stage is StorageMoveStage =>
  (STORAGE_MOVE_STAGES as readonly string[]).includes(stage);
/** A copy in progress; never a file anything reads. */
export const MOVE_PARTIAL_SUFFIX = ".cvm-move-partial";
/** The move finished: its `StorageMoveResult`, as a Job Event. */
export const STORAGE_MOVED_EVENT = "storage-moved";
/** A partial copy the Job is about to make, `{ path }`: its to delete (#2169). */
export const MOVE_PARTIAL_EVENT = "move-partial";
/** Every partial the Job recorded is gone, `{ files, bytes }` (#2169). */
export const MOVE_PARTIALS_SWEPT_EVENT = "move-partials-swept";
/**
 * A copy the Job placed (or verified by checksum) at its real name, with its
 * proof (#2179): a resumed run trusts it while both sizes and mtimes match.
 */
export const MOVE_PLACED_EVENT = "move-placed";
export type MovePlacedProof = {
  /** The copy's absolute path on the target. */
  readonly path: string;
  readonly size: number;
  readonly sourceMtimeMs: number;
  readonly destMtimeMs: number;
  /** SHA-256 of the source, which the copy's read-back matched. */
  readonly sha256: string;
};

/**
 * What a whole-bucket move moves: "AI Coding Crash Course Footage", "Clip
 * Mockups". A bucket whose name already says what it holds is not said twice:
 * "Unused Footage", never "Unused Footage Footage" (#2166).
 */
export const storageMoveSubject = (
  bucketName: string,
  kind: StorageMoveKind
) => {
  if (kind === "clip-mockups") return STORAGE_MOVE_KIND_LABELS[kind];
  const label = STORAGE_MOVE_KIND_LABELS[kind];
  return bucketName.toLowerCase().endsWith(label.toLowerCase())
    ? bucketName
    : `${bucketName} ${label}`;
};

/** The Job's title: "Move AI Coding Crash Course Footage to E:". */
export const storageMoveTitle = (
  bucketName: string,
  kind: StorageMoveKind,
  targetLabel: string,
  /** A per-file move's files: "Move a.mkv to E:", "Move 3 files to E:". */
  paths?: readonly string[]
) =>
  paths !== undefined && paths.length > 0
    ? `Move ${paths.length === 1 ? paths[0]!.split("/").pop() : `${paths.length} ${bucketName} files`} to ${targetLabel}`
    : `Move ${storageMoveSubject(bucketName, kind)} to ${targetLabel}`;
