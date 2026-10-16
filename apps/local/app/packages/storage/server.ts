// Entry point (server) for the storage package: finding a stored path on disk.
//
// A root-relative path is looked for on each Storage Root in order and the
// first root that has it wins, so a file mid-move (on both drives) is read
// from the first. Not found anywhere fails with `StorageFileNotFoundError`,
// whose message names the roots that are offline ("E: offline?").
export {
  StorageFileNotFoundError,
  findStoragePath,
  findStoragePathSync,
  resolveStoragePath,
  rootIsOnline,
} from "./lib/resolve";

// An agent's process (a verify-cvm run, a `cvm_verify_*` database,
// CVM_NO_REAL_DRIVES=1) never reads a real drive (/mnt): resolution above
// refuses such a path before touching it, and the startup check refuses a
// Storage Root on one.
export {
  NO_REAL_DRIVES_ENV_KEY,
  VERIFY_RUN_DIR_ENV_KEY,
  realDriveReached,
  realDriveRefusal,
  realDrivesForbidden,
} from "./lib/real-drives";
