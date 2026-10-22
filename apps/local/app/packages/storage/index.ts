// Entry point (pure) for the storage package: Storage Roots and root-relative
// paths.
//
// Every drive CVM's files may be on is a Storage Root (`STORAGE_ROOTS`, in
// order). The database stores a path RELATIVE to a root, with no drive in it,
// so moving a file between drives changes no row and no Export Hash. A legacy
// absolute path under a root reads as its relative form; an absolute path under
// no root (a Recording Session in `~/Videos`, a repo asset) is not managed and
// is used exactly as stored.
//
// Finding the file on disk (first root that has it wins) is `./server.ts`.
export {
  InvalidStorageRootsError,
  STORAGE_FOLDERS,
  folderOnEveryRoot,
  parseStorageRoots,
  rootLabel,
  rootRelativePath,
  storageCandidates,
  toRootRelative,
  writeFolder,
  type StorageFolder,
  type StorageRoots,
} from "./lib/storage-roots";

// A Storage Root that is Offline (an unplugged drive, a stale WSL mount
// answering ENODEV) is an expected, typed failure, not a missing file.
export {
  StorageRootOfflineError,
  offlineRootMessage,
  storageRootOfflineErrorOf,
} from "./lib/offline";
