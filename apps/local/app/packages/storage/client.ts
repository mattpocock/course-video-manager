// Entry point (public, browser-safe) for the storage package: the scan's wire
// format, for the Storage page.
//
// WHY A SECOND ENTRY POINT. `buckets.ts` re-exports `lib/buckets`, which
// classifies files by path with `node:path` (and reaches `lib/storage-roots`,
// which does too). That is right on the server and cannot run in a browser —
// so the Storage page importing `STORAGE_SCAN_MESSAGE_TYPES` from `buckets.ts`
// pulled `node:path` into the client bundle and failed the production build.
// Same split as `course-json/client.ts`.
//
// Everything here comes from `lib/scan-wire` and `lib/bucket-files` (the
// per-bucket page's listing), whose only imports are type-only (erased), plus
// the bucket TYPES the messages carry. Import THIS from a
// component, a hook, or a route's default export; import `buckets.ts` from a
// loader, a service or the scan.
export type {
  StorageBucket,
  StorageBucketKind,
  StorageFileKind,
  StorageFileRole,
} from "./lib/buckets";
export {
  addFoundFiles,
  dropFilesAt,
  largestFirst,
  type StorageBucketFile,
} from "./lib/bucket-files";
export {
  DELETABLE_STORAGE_BUCKETS,
  bucketCanBeDeleted,
  type DeletableStorageBucketId,
  type StorageDeleteResult,
} from "./lib/scan-wire";
export {
  PURGEABLE_STORAGE_BUCKET_KINDS,
  bucketCanBePurged,
  purgedBytes,
  purgedFiles,
  type StoragePurgeResult,
  type StoragePurgeSkippedVideo,
} from "./lib/purge-wire";
export {
  STORAGE_BUCKET_FILES_MESSAGE_TYPES,
  STORAGE_SCAN_MESSAGE_TYPES,
  moveTargetRefusal,
  type StorageBucketFilesMessage,
  type StorageFileFound,
  type StorageRootReport,
  type StorageScanMessage,
  type StorageSizeDelta,
} from "./lib/scan-wire";
export {
  STORAGE_DELETED_EVENT,
  STORAGE_DELETE_JOB_KIND,
  STORAGE_DELETE_OPERATIONS,
  STORAGE_DELETE_STAGES,
  isStorageDeleteStage,
  storageDeleteSummary,
  storageDeleteTitle,
  type StorageDeleteJobResult,
  type StorageDeleteOperation,
  type StorageDeleteStage,
} from "./lib/delete-job-wire";
export {
  originalsAt,
  type StorageOriginalsRefusalReason,
  type StorageOriginalsResult,
} from "./lib/originals-wire";
export {
  MOVE_PARTIAL_EVENT,
  MOVE_PARTIALS_SWEPT_EVENT,
  MOVE_PLACED_EVENT,
  STORAGE_MOVED_EVENT,
  STORAGE_MOVE_JOB_KIND,
  STORAGE_MOVE_KINDS,
  STORAGE_MOVE_KIND_LABELS,
  STORAGE_MOVE_STAGES,
  isStorageMoveStage,
  movableKindsOf,
  storageMoveSubject,
  storageMoveTitle,
  type StorageMoveKind,
  type StorageMovePlan,
  type StorageMoveRefusal,
  type StorageMoveRefusalReason,
  type StorageMoveResult,
  type StorageMoveStage,
} from "./lib/move-wire";
export {
  UNUSED_FOOTAGE_MIN_AGE_DAYS,
  unusedDeletedFiles,
  type StorageUnusedDeleteResult,
  type StorageUnusedRefusalReason,
} from "./lib/unused-wire";

// The Imported Footage rule, with no `node:path`: the editor's preview gain
// asks it for a Clip added since the page loaded (#2719).
export { isImportedFootage } from "./lib/imported-footage-rule";
