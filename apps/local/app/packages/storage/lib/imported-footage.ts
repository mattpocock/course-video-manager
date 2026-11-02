import path from "node:path";
import { STORAGE_FOLDERS } from "./storage-roots";

/**
 * Where Imported Footage is: Footage CVM did not film, copied in by
 * `cvm footage import`. It has no row; it is Imported Footage because of where
 * it is, anywhere under this folder on any Storage Root. Nested folders count,
 * so a later multi-track import can put several files in one folder.
 *
 * The only place the folder's name is spelled: the import, the Storage
 * Buckets, the search and the B-roll checks all ask {@link isImportedFootage}.
 */
const IMPORTED_FOOTAGE_FOLDER = path.posix.join(
  STORAGE_FOLDERS.rawFootage,
  "imported"
);

/**
 * Whether a root-relative path is Imported Footage. An absolute path is not
 * root-relative, so it is not: make it root-relative first (`toRootRelative`).
 */
export const isImportedFootage = (rootRelative: string): boolean => {
  if (path.posix.isAbsolute(rootRelative)) return false;
  return path.posix
    .normalize(rootRelative)
    .startsWith(`${IMPORTED_FOOTAGE_FOLDER}/`);
};
