// Entry point (pure) for the storage package: Storage Buckets and the scan's
// wire format.
//
// A Storage Bucket is the unit the Storage page counts space in: each Course,
// Standalone Videos, Shorts, Shared Footage (Footage Clips in more than one Course
// use), Unused Footage (Footage under `raw-footage/` no Clip and no
// Recording Session uses), Used and Unused Imported Footage (everything under
// `raw-footage/imported/`, never Unused Footage, never deleted), and the
// Other buckets (Clip Mockups, the Overlay
// Render Cache, export scratch, Exported Videos of no current Video). The scan streams
// `StorageScanMessage`s; the page adds them up. The per-bucket page's
// listing streams `StorageBucketFilesMessage`s, gathered with `addFoundFiles`
// and shown `largestFirst`. Running the scan is
// `./scan.ts`.
export {
  assignStorageBuckets,
  classifyStorageFile,
  courseBucketId,
  type StorageBucket,
  type StorageBucketKind,
  type StorageFileClass,
  type StorageFileKind,
  type StorageFileRole,
  type StorageOwnership,
  type StorageOwnershipInput,
  USED_IMPORTED_FOOTAGE_ID,
} from "./lib/buckets";
export {
  windowsDriveOf,
  parseDirtyQueryOutput,
  type VolumeDirtyBit,
} from "./lib/dirty-bit";
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
