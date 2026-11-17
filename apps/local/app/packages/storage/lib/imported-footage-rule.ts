import { STORAGE_FOLDERS } from "./storage-folders";

/**
 * Where Imported Footage is: Footage CVM did not film, copied in by
 * `cvm footage import`. It has no row; it is Imported Footage because of where
 * it is, anywhere under this folder on any Storage Root. Nested folders count,
 * so a later multi-track import can put several files in one folder.
 *
 * The only place the folder's name is spelled: the import, the Storage
 * Buckets, the search and the editor's preview gain ask
 * {@link isImportedFootage}. Browser-safe (no `node:path`): the editor asks it
 * for a Clip added since the page loaded.
 */
export const IMPORTED_FOOTAGE_FOLDER = `${STORAGE_FOLDERS.rawFootage}/imported`;

/** A POSIX path with `.`, `..` and repeated slashes resolved, as `path.posix.normalize` does for a relative path. */
const normalizeRelative = (relative: string): string => {
  const parts: string[] = [];
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
};

/**
 * Whether a root-relative path is Imported Footage. An absolute path is not
 * root-relative, so it is not: make it root-relative first (`toRootRelative`).
 */
export const isImportedFootage = (rootRelative: string): boolean => {
  if (rootRelative.startsWith("/")) return false;
  return normalizeRelative(rootRelative).startsWith(
    `${IMPORTED_FOOTAGE_FOLDER}/`
  );
};
