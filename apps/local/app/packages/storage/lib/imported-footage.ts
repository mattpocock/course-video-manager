import path from "node:path";
import { STORAGE_FOLDERS } from "./storage-roots";

/**
 * Where Imported Footage is: Footage CVM did not film, copied in by
 * `cvm footage import`. It has no row; it is Imported Footage because of where
 * it is, anywhere under this folder on any Storage Root. Nested folders count,
 * so a later multi-track import can put several files in one folder.
 *
 * The only place the folder's name is spelled: the import, the Storage
 * Buckets and the search ask {@link isImportedFootage}.
 */
export const IMPORTED_FOOTAGE_FOLDER = path.posix.join(
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

/**
 * What an import writes first, beside the file it will become
 * (`<file>.cvm-import-partial`). It is renamed into place only once its size
 * and checksum match the source, so a cut-off copy never has the final name.
 * One of an Imported Footage file's companions, like its transcript.
 */
export const IMPORT_PARTIAL_SUFFIX = ".cvm-import-partial";

/** The file types Footage comes in: what an import takes, and lists. */
export const FOOTAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".mp4",
  ".mkv",
  ".mov",
  ".webm",
  ".avi",
  ".m4v",
]);

/** Whether a file name is one of {@link FOOTAGE_EXTENSIONS}, any case. */
export const isFootageFileName = (name: string): boolean =>
  FOOTAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
